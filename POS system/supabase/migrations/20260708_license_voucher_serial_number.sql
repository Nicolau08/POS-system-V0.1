-- Número de série por voucher (instalação Zone Soft: serial → loja).
-- Vouchers antigos podem ficar sem serial; novas emissões passam a ter sempre.

ALTER TABLE public.license_vouchers
  ADD COLUMN IF NOT EXISTS serial_number text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_license_vouchers_serial_number
  ON public.license_vouchers (serial_number)
  WHERE serial_number IS NOT NULL AND TRIM(serial_number) <> '';

COMMENT ON COLUMN public.license_vouchers.serial_number IS
  'Número de série X_XXXXXXXX para instalação local; 1 serial = 1 loja (cliente).';
