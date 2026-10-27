-- Fase 5 — Skema awal Kas Keluarga.
-- Semua tabel langsung RLS aktif (tanpa kebijakan = tertutup total) supaya tidak ada
-- jendela waktu tabel terbuka lewat Data API sebelum migrasi kebijakan (0002) terpasang.
-- Uang = bigint rupiah.

-- Skema meta runner migrasi tidak boleh dijangkau peran API.
revoke all on schema kas_meta from public, anon, authenticated;

-- ---------------------------------------------------------------- fungsi trigger umum
create or replace function public.tg_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- keluarga_id (dan id) tidak boleh berubah setelah baris dibuat.
create or replace function public.tg_kunci_keluarga() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.keluarga_id is distinct from old.keluarga_id then
    raise exception 'keluarga_id tidak boleh diubah' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- keluarga
create table public.keluarga (
  id          uuid primary key default gen_random_uuid(),
  nama        text not null check (char_length(btrim(nama)) between 1 and 60),
  mata_uang   text not null default 'IDR' check (mata_uang ~ '^[A-Z]{3}$'),
  zona_waktu  text not null default 'Asia/Jakarta',
  dibuat_oleh uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger keluarga_updated before update on public.keluarga
  for each row execute function public.tg_updated_at();

-- ---------------------------------------------------------------- anggota
create table public.anggota (
  keluarga_id   uuid not null references public.keluarga(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  nama_tampilan text not null check (char_length(btrim(nama_tampilan)) between 1 and 40),
  peran         text not null default 'anggota' check (peran in ('pemilik', 'anggota', 'lihat')),
  aktif         boolean not null default true,
  bergabung_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (keluarga_id, user_id)
);
create index anggota_user_idx on public.anggota (user_id);
create trigger anggota_updated before update on public.anggota
  for each row execute function public.tg_updated_at();
create trigger anggota_kunci before update on public.anggota
  for each row execute function public.tg_kunci_keluarga();

-- ---------------------------------------------------------------- kategori
create table public.kategori (
  id          uuid primary key default gen_random_uuid(),
  keluarga_id uuid not null references public.keluarga(id) on delete cascade,
  nama        text not null check (char_length(btrim(nama)) between 1 and 40),
  jenis       text not null check (jenis in ('keluar', 'masuk')),
  ikon        text not null default '•' check (char_length(ikon) <= 8),
  warna       text check (warna ~ '^#[0-9a-fA-F]{6}$'),
  urutan      integer not null default 0,
  arsip       boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (keluarga_id, id)
);
create unique index kategori_nama_unik on public.kategori (keluarga_id, jenis, lower(btrim(nama))) where not arsip;
create trigger kategori_updated before update on public.kategori
  for each row execute function public.tg_updated_at();
create trigger kategori_kunci before update on public.kategori
  for each row execute function public.tg_kunci_keluarga();

-- ---------------------------------------------------------------- dompet (rekening/dompet; tanpa nomor rekening/kartu)
create table public.dompet (
  id          uuid primary key default gen_random_uuid(),
  keluarga_id uuid not null references public.keluarga(id) on delete cascade,
  nama        text not null check (char_length(btrim(nama)) between 1 and 40),
  jenis       text not null default 'tunai' check (jenis in ('tunai', 'bank', 'ewallet', 'kartu_kredit', 'lainnya')),
  saldo_awal  bigint not null default 0 check (abs(saldo_awal) < 1000000000000000),
  urutan      integer not null default 0,
  arsip       boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (keluarga_id, id)
);
create unique index dompet_nama_unik on public.dompet (keluarga_id, lower(btrim(nama))) where not arsip;
create trigger dompet_updated before update on public.dompet
  for each row execute function public.tg_updated_at();
create trigger dompet_kunci before update on public.dompet
  for each row execute function public.tg_kunci_keluarga();

-- ---------------------------------------------------------------- transaksi
-- id dibuat di HP (uuid) → upsert idempoten untuk antrian offline.
-- jenis: keluar/masuk (jumlah > 0, wajib kategori), pindah (antar dompet, tanpa kategori),
--        penyesuaian (hasil "cocokkan saldo", jumlah bertanda ±, tanpa kategori, tidak masuk laporan).
-- FK komposit (keluarga_id, x_id) menjamin kategori/dompet milik keluarga yang sama
-- (pemeriksaan FK tidak tunduk pada RLS, jadi ini wajib).
create table public.transaksi (
  id               uuid primary key default gen_random_uuid(),
  keluarga_id      uuid not null references public.keluarga(id) on delete cascade,
  jenis            text not null check (jenis in ('keluar', 'masuk', 'pindah', 'penyesuaian')),
  tanggal          date not null check (tanggal between date '2000-01-01' and date '2100-12-31'),
  jumlah           bigint not null check (jumlah <> 0 and abs(jumlah) < 1000000000000000),
  kategori_id      uuid,
  dompet_id        uuid not null,
  dompet_tujuan_id uuid,
  catatan          text check (char_length(catatan) <= 200),
  wajar            boolean not null default false,
  dicatat_oleh     uuid references auth.users(id) on delete set null,
  dibuat_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  dihapus_at       timestamptz,
  foreign key (keluarga_id, kategori_id) references public.kategori (keluarga_id, id),
  foreign key (keluarga_id, dompet_id) references public.dompet (keluarga_id, id),
  foreign key (keluarga_id, dompet_tujuan_id) references public.dompet (keluarga_id, id),
  constraint transaksi_jumlah_positif check (jenis = 'penyesuaian' or jumlah > 0),
  constraint transaksi_kategori check ((jenis in ('keluar', 'masuk')) = (kategori_id is not null)),
  constraint transaksi_pindah check ((jenis = 'pindah') = (dompet_tujuan_id is not null)),
  constraint transaksi_pindah_beda check (dompet_tujuan_id is null or dompet_tujuan_id <> dompet_id)
);
create index transaksi_keluarga_tanggal on public.transaksi (keluarga_id, tanggal desc);
create index transaksi_keluarga_updated on public.transaksi (keluarga_id, updated_at);
create index transaksi_kategori_idx on public.transaksi (keluarga_id, kategori_id);
create index transaksi_dompet_idx on public.transaksi (keluarga_id, dompet_id);
create index transaksi_dompet_tujuan_idx on public.transaksi (keluarga_id, dompet_tujuan_id);

-- Jenis kategori harus cocok dengan jenis transaksi (keluar ↔ keluar).
-- dicatat_oleh dipaksa = pengguna yang menyisipkan; tidak bisa diubah.
create or replace function public.tg_transaksi() returns trigger
language plpgsql set search_path = '' as $$
declare j text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.dicatat_oleh := auth.uid(); end if;
    new.dibuat_at := now();
  else
    if new.keluarga_id is distinct from old.keluarga_id then
      raise exception 'keluarga_id tidak boleh diubah' using errcode = '42501';
    end if;
    new.dicatat_oleh := old.dicatat_oleh;
    new.dibuat_at := old.dibuat_at;
  end if;
  new.updated_at := now();
  if new.kategori_id is not null then
    select k.jenis into j from public.kategori k where k.id = new.kategori_id;
    if j is distinct from new.jenis then
      raise exception 'jenis kategori (%) tidak cocok dengan jenis transaksi (%)', j, new.jenis using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger transaksi_aturan before insert or update on public.transaksi
  for each row execute function public.tg_transaksi();

-- ---------------------------------------------------------------- anggaran (per kategori keluar per bulan)
create table public.anggaran (
  id          uuid primary key default gen_random_uuid(),
  keluarga_id uuid not null references public.keluarga(id) on delete cascade,
  bulan       date not null check (extract(day from bulan) = 1),
  kategori_id uuid not null,
  jumlah      bigint not null check (jumlah >= 0 and jumlah < 1000000000000000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (keluarga_id, bulan, kategori_id),
  foreign key (keluarga_id, kategori_id) references public.kategori (keluarga_id, id) on delete cascade
);
create trigger anggaran_updated before update on public.anggaran
  for each row execute function public.tg_updated_at();
create trigger anggaran_kunci before update on public.anggaran
  for each row execute function public.tg_kunci_keluarga();

-- ---------------------------------------------------------------- hak akses dasar
-- RLS aktif di semua tabel; kebijakan dipasang di 0002.
alter table public.keluarga  enable row level security;
alter table public.anggota   enable row level security;
alter table public.kategori  enable row level security;
alter table public.dompet    enable row level security;
alter table public.transaksi enable row level security;
alter table public.anggaran  enable row level security;

-- Tanpa akses anonim sama sekali; authenticated hanya DML biasa (tanpa TRUNCATE/REFERENCES/TRIGGER).
revoke all on public.keluarga, public.anggota, public.kategori, public.dompet, public.transaksi, public.anggaran
  from anon, authenticated, public;
grant select, insert, update, delete on public.keluarga, public.anggota, public.kategori,
  public.dompet, public.transaksi, public.anggaran to authenticated;

revoke execute on function public.tg_updated_at(), public.tg_kunci_keluarga(), public.tg_transaksi()
  from public, anon, authenticated;
