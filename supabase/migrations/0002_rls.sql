-- Fase 6 — Row Level Security: tiap keluarga hanya melihat & mengubah datanya sendiri.
-- Peran: pemilik (semua), anggota (catat/ubah), lihat (baca saja).

-- ---------------------------------------------------------------- fungsi bantu
-- SECURITY DEFINER supaya membaca tabel anggota tanpa rekursi RLS.
create or replace function public.peran_di(k uuid) returns text
language sql stable security definer set search_path = '' as $$
  select a.peran from public.anggota a
  where a.keluarga_id = k and a.user_id = (select auth.uid()) and a.aktif
$$;

create or replace function public.anggota_dari(k uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.peran_di(k) is not null
$$;

create or replace function public.bisa_tulis(k uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.peran_di(k) in ('pemilik', 'anggota'), false)
$$;

create or replace function public.pemilik_dari(k uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.peran_di(k) = 'pemilik', false)
$$;

revoke execute on function public.peran_di(uuid), public.anggota_dari(uuid), public.bisa_tulis(uuid), public.pemilik_dari(uuid)
  from public, anon;
grant execute on function public.peran_di(uuid), public.anggota_dari(uuid), public.bisa_tulis(uuid), public.pemilik_dari(uuid)
  to authenticated;

-- ---------------------------------------------------------------- keluarga
-- Tidak ada INSERT langsung (lewat RPC buat_keluarga); tidak ada DELETE dari aplikasi.
create policy keluarga_baca on public.keluarga for select to authenticated
  using (public.anggota_dari(id));
create policy keluarga_ubah on public.keluarga for update to authenticated
  using (public.pemilik_dari(id)) with check (public.pemilik_dari(id));

-- ---------------------------------------------------------------- anggota
-- Tambah anggota lewat RPC tambah_anggota; ubah/hapus hanya pemilik.
create policy anggota_baca on public.anggota for select to authenticated
  using (public.anggota_dari(keluarga_id));
create policy anggota_ubah on public.anggota for update to authenticated
  using (public.pemilik_dari(keluarga_id)) with check (public.pemilik_dari(keluarga_id));
create policy anggota_hapus on public.anggota for delete to authenticated
  using (public.pemilik_dari(keluarga_id));

-- Keluarga tidak boleh kehilangan pemilik aktif terakhir.
create or replace function public.tg_pemilik_terakhir() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.keluarga k where k.id = old.keluarga_id)
     and not exists (select 1 from public.anggota a
                     where a.keluarga_id = old.keluarga_id and a.peran = 'pemilik' and a.aktif) then
    raise exception 'Keluarga harus punya minimal satu pemilik aktif' using errcode = '23514';
  end if;
  return null;
end $$;
revoke execute on function public.tg_pemilik_terakhir() from public, anon, authenticated;
create constraint trigger anggota_pemilik_terakhir after update or delete on public.anggota
  deferrable initially immediate
  for each row execute function public.tg_pemilik_terakhir();

-- ---------------------------------------------------------------- kategori, dompet, anggaran
create policy kategori_baca on public.kategori for select to authenticated using (public.anggota_dari(keluarga_id));
create policy kategori_tambah on public.kategori for insert to authenticated with check (public.bisa_tulis(keluarga_id));
create policy kategori_ubah on public.kategori for update to authenticated
  using (public.bisa_tulis(keluarga_id)) with check (public.bisa_tulis(keluarga_id));
create policy kategori_hapus on public.kategori for delete to authenticated using (public.bisa_tulis(keluarga_id));

create policy dompet_baca on public.dompet for select to authenticated using (public.anggota_dari(keluarga_id));
create policy dompet_tambah on public.dompet for insert to authenticated with check (public.bisa_tulis(keluarga_id));
create policy dompet_ubah on public.dompet for update to authenticated
  using (public.bisa_tulis(keluarga_id)) with check (public.bisa_tulis(keluarga_id));
create policy dompet_hapus on public.dompet for delete to authenticated using (public.bisa_tulis(keluarga_id));

create policy anggaran_baca on public.anggaran for select to authenticated using (public.anggota_dari(keluarga_id));
create policy anggaran_tambah on public.anggaran for insert to authenticated with check (public.bisa_tulis(keluarga_id));
create policy anggaran_ubah on public.anggaran for update to authenticated
  using (public.bisa_tulis(keluarga_id)) with check (public.bisa_tulis(keluarga_id));
create policy anggaran_hapus on public.anggaran for delete to authenticated using (public.bisa_tulis(keluarga_id));

-- ---------------------------------------------------------------- transaksi
-- Hapus biasa = hapus lunak (UPDATE dihapus_at). Hapus permanen hanya pemilik.
create policy transaksi_baca on public.transaksi for select to authenticated using (public.anggota_dari(keluarga_id));
create policy transaksi_tambah on public.transaksi for insert to authenticated with check (public.bisa_tulis(keluarga_id));
create policy transaksi_ubah on public.transaksi for update to authenticated
  using (public.bisa_tulis(keluarga_id)) with check (public.bisa_tulis(keluarga_id));
create policy transaksi_hapus on public.transaksi for delete to authenticated using (public.pemilik_dari(keluarga_id));

-- ---------------------------------------------------------------- RPC
-- Membuat keluarga baru + pemilik + kategori & dompet awal (asumsi bawaan PT-2/PT-3).
create or replace function public.buat_keluarga(p_nama text, p_nama_tampilan text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  kid uuid;
begin
  if uid is null then raise exception 'Harus masuk dulu' using errcode = '42501'; end if;
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

-- Pemilik menambah/mengaktifkan kembali anggota berdasarkan email akun yang sudah dibuat di dasbor Supabase.
create or replace function public.tambah_anggota(p_keluarga uuid, p_email text, p_nama_tampilan text, p_peran text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if not public.pemilik_dari(p_keluarga) then
    raise exception 'Hanya pemilik yang boleh menambah anggota' using errcode = '42501';
  end if;
  if p_peran not in ('pemilik', 'anggota', 'lihat') then
    raise exception 'Peran tidak dikenal' using errcode = '22023';
  end if;
  select u.id into target from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  if target is null then
    raise exception 'Akun dengan email itu belum dibuat. Buat dulu di dasbor Supabase (Authentication > Users > Add user).'
      using errcode = 'P0002';
  end if;
  insert into public.anggota (keluarga_id, user_id, nama_tampilan, peran, aktif)
  values (p_keluarga, target, btrim(p_nama_tampilan), p_peran, true)
  on conflict (keluarga_id, user_id)
  do update set nama_tampilan = excluded.nama_tampilan, peran = excluded.peran, aktif = true;
  return target;
end $$;

revoke execute on function public.buat_keluarga(text, text), public.tambah_anggota(uuid, text, text, text)
  from public, anon;
grant execute on function public.buat_keluarga(text, text), public.tambah_anggota(uuid, text, text, text)
  to authenticated;
