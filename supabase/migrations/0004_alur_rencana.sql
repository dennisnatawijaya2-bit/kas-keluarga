-- Fase 16 — Alur uang, dompet Simpanan, kategori tetap/harian, rencana rutin, setelan keluarga.

-- 1) Setelan keluarga (periode, peringatan, dst.) — hanya pemilik yang mengubah (kebijakan keluarga_ubah).
alter table public.keluarga add column setelan jsonb not null default '{}'::jsonb
  check (jsonb_typeof(setelan) = 'object' and pg_column_size(setelan) < 8192);
grant update (setelan) on public.keluarga to authenticated;

-- 2) Dompet Simpanan: uang yang dipindah ke sini = "disisihkan", tidak dihitung sebagai uang belanja.
alter table public.dompet drop constraint dompet_jenis_check;
alter table public.dompet add constraint dompet_jenis_check
  check (jenis in ('tunai', 'bank', 'ewallet', 'kartu_kredit', 'simpanan', 'lainnya'));

-- 3) Kelompok kategori pengeluaran: tetap (tagihan/kewajiban) vs harian.
alter table public.kategori add column kelompok text not null default 'harian' check (kelompok in ('tetap', 'harian'));
update public.kategori set kelompok = 'tetap'
where jenis = 'keluar' and nama in ('Listrik, Air & Internet', 'Pulsa & Paket Data', 'Pendidikan Anak', 'Cicilan & Tagihan', 'Asuransi');

-- 4) Rencana rutin per periode: tagihan (bayar), sisih (pindah ke Simpanan), pemasukan (perkiraan gaji).
create table public.rutin (
  id               uuid primary key default gen_random_uuid(),
  keluarga_id      uuid not null references public.keluarga(id) on delete cascade,
  jenis            text not null check (jenis in ('tagihan', 'sisih', 'pemasukan')),
  nama             text not null check (char_length(btrim(nama)) between 1 and 40),
  jumlah           bigint not null check (jumlah > 0 and jumlah < 1000000000000000),
  hari             smallint check (hari between 1 and 31),         -- perkiraan tanggal dalam periode
  kategori_id      uuid,
  dompet_id        uuid,
  dompet_tujuan_id uuid,
  urutan           integer not null default 0,
  arsip            boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (keluarga_id, id),
  foreign key (keluarga_id, kategori_id) references public.kategori (keluarga_id, id),
  foreign key (keluarga_id, dompet_id) references public.dompet (keluarga_id, id),
  foreign key (keluarga_id, dompet_tujuan_id) references public.dompet (keluarga_id, id),
  constraint rutin_bentuk check (
    (jenis = 'tagihan' and kategori_id is not null and dompet_tujuan_id is null) or
    (jenis = 'pemasukan' and kategori_id is not null and dompet_tujuan_id is null) or
    (jenis = 'sisih' and kategori_id is null and dompet_tujuan_id is not null))
);
create index rutin_keluarga_idx on public.rutin (keluarga_id);
create index rutin_kategori_idx on public.rutin (keluarga_id, kategori_id);
create index rutin_dompet_idx on public.rutin (keluarga_id, dompet_id);
create index rutin_dompet_tujuan_idx on public.rutin (keluarga_id, dompet_tujuan_id);
create trigger rutin_updated before update on public.rutin for each row execute function public.tg_updated_at();
create trigger rutin_kunci before update on public.rutin for each row execute function public.tg_kunci_keluarga();

alter table public.rutin enable row level security;
revoke all on public.rutin from anon, authenticated, public;
grant select, insert, update on public.rutin to authenticated;   -- tanpa hapus: cukup arsip
create policy rutin_baca on public.rutin for select to authenticated using (public.anggota_dari(keluarga_id));
create policy rutin_tambah on public.rutin for insert to authenticated with check (public.bisa_tulis(keluarga_id));
create policy rutin_ubah on public.rutin for update to authenticated
  using (public.bisa_tulis(keluarga_id)) with check (public.bisa_tulis(keluarga_id));

-- Jenis kategori rutin harus cocok: tagihan → kategori keluar, pemasukan → kategori masuk.
create or replace function public.tg_rutin_kategori() returns trigger
language plpgsql set search_path = '' as $$
declare j text;
begin
  if new.kategori_id is not null then
    select k.jenis into j from public.kategori k where k.id = new.kategori_id;
    if (new.jenis = 'tagihan' and j is distinct from 'keluar') or (new.jenis = 'pemasukan' and j is distinct from 'masuk') then
      raise exception 'Kategori tidak cocok dengan jenis rencana' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.tg_rutin_kategori() from public, anon, authenticated;
create trigger rutin_kategori before insert or update on public.rutin for each row execute function public.tg_rutin_kategori();

-- 5) Transaksi bisa menandai rencana rutin yang dipenuhinya (untuk centang "sudah dibayar").
alter table public.transaksi add column rutin_id uuid;
alter table public.transaksi add constraint transaksi_rutin_fk
  foreign key (keluarga_id, rutin_id) references public.rutin (keluarga_id, id);
create index transaksi_rutin_idx on public.transaksi (keluarga_id, rutin_id);

-- 6) Keluarga baru: kategori tetap ditandai, dompet Tabungan (Simpanan) ikut dibuat.
create or replace function public.buat_keluarga(p_nama text, p_nama_tampilan text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  kid uuid;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Harus masuk dengan akun terdaftar' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('buat_keluarga:' || uid::text));
  if (select count(*) from public.keluarga k where k.dibuat_oleh = uid) >= 3 then
    raise exception 'Batas 3 keluarga per akun' using errcode = '54000';
  end if;

  insert into public.keluarga (nama, dibuat_oleh) values (btrim(p_nama), uid) returning id into kid;
  insert into public.anggota (keluarga_id, user_id, nama_tampilan, peran)
    values (kid, uid, btrim(p_nama_tampilan), 'pemilik');

  insert into public.kategori (keluarga_id, nama, jenis, ikon, urutan, kelompok)
  select kid, x.nama, x.jenis, x.ikon, x.urutan, x.kelompok
  from (values
    ('Makan & Dapur', 'keluar', '🍚', 1, 'harian'), ('Belanja Rumah', 'keluar', '🛒', 2, 'harian'),
    ('Transportasi & BBM', 'keluar', '⛽', 3, 'harian'), ('Listrik, Air & Internet', 'keluar', '💡', 4, 'tetap'),
    ('Pulsa & Paket Data', 'keluar', '📱', 5, 'tetap'), ('Pendidikan Anak', 'keluar', '🎒', 6, 'tetap'),
    ('Kesehatan', 'keluar', '💊', 7, 'harian'), ('Cicilan & Tagihan', 'keluar', '🧾', 8, 'tetap'),
    ('Asuransi', 'keluar', '🛡', 9, 'tetap'), ('Sosial & Persembahan', 'keluar', '🤝', 10, 'harian'),
    ('Hiburan & Jalan-jalan', 'keluar', '🎡', 11, 'harian'), ('Pakaian', 'keluar', '👕', 12, 'harian'),
    ('Perawatan Rumah & Kendaraan', 'keluar', '🔧', 13, 'harian'), ('Lain-lain', 'keluar', '•', 99, 'harian'),
    ('Gaji', 'masuk', '💼', 1, 'harian'), ('Usaha', 'masuk', '🏪', 2, 'harian'), ('Lain-lain', 'masuk', '•', 99, 'harian')
  ) as x(nama, jenis, ikon, urutan, kelompok);

  insert into public.dompet (keluarga_id, nama, jenis, urutan)
  values (kid, 'Tunai', 'tunai', 1), (kid, 'Bank', 'bank', 2), (kid, 'E-wallet', 'ewallet', 3), (kid, 'Tabungan', 'simpanan', 4);

  return kid;
end $$;

-- 7) Keluarga yang sudah ada: tambahkan dompet Tabungan (Simpanan) bila belum ada dompet simpanan.
insert into public.dompet (keluarga_id, nama, jenis, urutan)
select k.id, 'Tabungan', 'simpanan', 4 from public.keluarga k
where not exists (select 1 from public.dompet d where d.keluarga_id = k.id and d.jenis = 'simpanan')
  and not exists (select 1 from public.dompet d where d.keluarga_id = k.id and lower(d.nama) = 'tabungan' and not d.arsip);
