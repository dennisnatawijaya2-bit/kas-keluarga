-- Perbaikan hasil QC Fase 5–6 (temuan MEDIUM/LOW).

-- 1) Kolom yang boleh diubah lewat API dibatasi per kolom.
revoke update on public.keluarga from authenticated;
grant update (nama, mata_uang, zona_waktu) on public.keluarga to authenticated;
revoke update on public.anggota from authenticated;
grant update (nama_tampilan, peran, aktif) on public.anggota to authenticated;

-- 2) updated_at memakai jam nyata (bukan awal transaksi) agar tarik-sinkron tidak melewatkan baris.
--    id & created_at tidak boleh berubah.
create or replace function public.tg_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

create or replace function public.tg_kunci_keluarga() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.keluarga_id is distinct from old.keluarga_id then
    raise exception 'keluarga_id tidak boleh diubah' using errcode = '42501';
  end if;
  if to_jsonb(new) ? 'id' and (to_jsonb(new) ->> 'id') is distinct from (to_jsonb(old) ->> 'id') then
    raise exception 'id tidak boleh diubah' using errcode = '42501';
  end if;
  if to_jsonb(new) ? 'created_at' then
    if (to_jsonb(new) ->> 'created_at') is distinct from (to_jsonb(old) ->> 'created_at') then
      raise exception 'created_at tidak boleh diubah' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- 3) Transaksi: id terkunci; hapus lunak tidak bisa dibatalkan oleh kiriman ulang HP yang tertinggal.
create or replace function public.tg_transaksi() returns trigger
language plpgsql set search_path = '' as $$
declare j text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.dicatat_oleh := auth.uid(); end if;
    new.dibuat_at := clock_timestamp();
  else
    if new.keluarga_id is distinct from old.keluarga_id then
      raise exception 'keluarga_id tidak boleh diubah' using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'id tidak boleh diubah' using errcode = '42501';
    end if;
    new.dicatat_oleh := old.dicatat_oleh;
    new.dibuat_at := old.dibuat_at;
    if old.dihapus_at is not null then
      new.dihapus_at := old.dihapus_at; -- sekali terhapus tetap terhapus
    end if;
  end if;
  new.updated_at := clock_timestamp();
  if new.kategori_id is not null then
    select k.jenis into j from public.kategori k where k.id = new.kategori_id;
    if j is distinct from new.jenis then
      raise exception 'jenis kategori (%) tidak cocok dengan jenis transaksi (%)', j, new.jenis using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- (keluarga & anggota: id/user_id/dibuat_oleh/created_at sudah terkunci oleh grant per kolom di butir 1)

-- 4) Kategori & dompet tidak dihapus keras dari aplikasi — cukup arsip (riwayat tetap utuh).
drop policy kategori_hapus on public.kategori;
drop policy dompet_hapus on public.dompet;
revoke delete on public.kategori, public.dompet from authenticated;

-- 5) Jenis kategori tidak boleh diubah setelah dipakai; anggaran hanya untuk kategori keluar.
create or replace function public.tg_kategori_jenis() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.jenis is distinct from old.jenis and (
       exists (select 1 from public.transaksi t where t.kategori_id = old.id)
       or exists (select 1 from public.anggaran a where a.kategori_id = old.id)) then
    raise exception 'Jenis kategori tidak bisa diubah karena sudah dipakai' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger kategori_jenis before update on public.kategori
  for each row execute function public.tg_kategori_jenis();

create or replace function public.tg_anggaran_keluar() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select k.jenis from public.kategori k where k.id = new.kategori_id) is distinct from 'keluar' then
    raise exception 'Anggaran hanya untuk kategori pengeluaran' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger anggaran_keluar before insert or update on public.anggaran
  for each row execute function public.tg_anggaran_keluar();

-- 6) Race: pemilik terakhir & kuota buat_keluarga.
create or replace function public.tg_pemilik_terakhir() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.keluarga k where k.id = old.keluarga_id for update;
  if found and not exists (select 1 from public.anggota a
                           where a.keluarga_id = old.keluarga_id and a.peran = 'pemilik' and a.aktif) then
    raise exception 'Keluarga harus punya minimal satu pemilik aktif' using errcode = '23514';
  end if;
  return null;
end $$;

-- 7) tambah_anggota: hanya akun terkonfirmasi, tidak mengembalikan user_id.
drop function public.tambah_anggota(uuid, text, text, text);
create function public.tambah_anggota(p_keluarga uuid, p_email text, p_nama_tampilan text, p_peran text)
returns void
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if not public.pemilik_dari(p_keluarga) then
    raise exception 'Hanya pemilik yang boleh menambah anggota' using errcode = '42501';
  end if;
  if p_peran not in ('pemilik', 'anggota', 'lihat') then
    raise exception 'Peran tidak dikenal' using errcode = '22023';
  end if;
  select u.id into target from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null
    and coalesce(u.is_anonymous, false) = false
  limit 1;
  if target is null then
    raise exception 'Akun dengan email itu belum ada atau belum dikonfirmasi. Buat dulu di dasbor Supabase (Authentication > Users > Add user, centang Auto Confirm User).'
      using errcode = 'P0002';
  end if;
  insert into public.anggota (keluarga_id, user_id, nama_tampilan, peran, aktif)
  values (p_keluarga, target, btrim(p_nama_tampilan), p_peran, true)
  on conflict (keluarga_id, user_id)
  do update set nama_tampilan = excluded.nama_tampilan, peran = excluded.peran, aktif = true;
end $$;
revoke execute on function public.tambah_anggota(uuid, text, text, text) from public, anon;
grant execute on function public.tambah_anggota(uuid, text, text, text) to authenticated;

-- buat_keluarga: kunci per pengguna agar kuota 3 tidak bisa dilewati panggilan paralel; akun anonim ditolak.
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

  insert into public.kategori (keluarga_id, nama, jenis, ikon, urutan)
  select kid, x.nama, x.jenis, x.ikon, x.urutan
  from (values
    ('Makan & Dapur', 'keluar', '🍚', 1), ('Belanja Rumah', 'keluar', '🛒', 2),
    ('Transportasi & BBM', 'keluar', '⛽', 3), ('Listrik, Air & Internet', 'keluar', '💡', 4),
    ('Pulsa & Paket Data', 'keluar', '📱', 5), ('Pendidikan Anak', 'keluar', '🎒', 6),
    ('Kesehatan', 'keluar', '💊', 7), ('Cicilan & Tagihan', 'keluar', '🧾', 8),
    ('Asuransi', 'keluar', '🛡', 9), ('Sosial & Persembahan', 'keluar', '🤝', 10),
    ('Hiburan & Jalan-jalan', 'keluar', '🎡', 11), ('Pakaian', 'keluar', '👕', 12),
    ('Perawatan Rumah & Kendaraan', 'keluar', '🔧', 13), ('Lain-lain', 'keluar', '•', 99),
    ('Gaji', 'masuk', '💼', 1), ('Usaha', 'masuk', '🏪', 2), ('Lain-lain', 'masuk', '•', 99)
  ) as x(nama, jenis, ikon, urutan);

  insert into public.dompet (keluarga_id, nama, jenis, urutan)
  values (kid, 'Tunai', 'tunai', 1), (kid, 'Bank', 'bank', 2), (kid, 'E-wallet', 'ewallet', 3);

  return kid;
end $$;

-- 8) Indeks FK & tarik-sinkron.
create index if not exists keluarga_dibuat_oleh_idx on public.keluarga (dibuat_oleh);
create index if not exists transaksi_dicatat_oleh_idx on public.transaksi (dicatat_oleh);
create index if not exists anggaran_kategori_idx on public.anggaran (keluarga_id, kategori_id);

-- 9) Objek baru di public tidak otomatis terbuka untuk anon (pengaman migrasi berikutnya).
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon, public;

revoke execute on function public.tg_kategori_jenis(), public.tg_anggaran_keluar() from public, anon, authenticated;
