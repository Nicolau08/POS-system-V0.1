-- Hierarchical product groups: parent category reference (UUID, same as categories.id).
-- If an older bigint parent_id column exists (legacy manual schema), rename it first.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'categories'
      AND column_name = 'parent_id'
      AND data_type IN ('bigint', 'integer', 'smallint')
  ) THEN
    ALTER TABLE public.categories RENAME COLUMN parent_id TO parent_id_legacy;
  END IF;
END $$;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories(parent_id);

COMMENT ON COLUMN public.categories.parent_id IS 'Parent group (UUID). Local POS parent_id is mapped to cloud_id on sync.';
