-- Facebook dual-app: login done, Page OAuth not finished yet.
ALTER TYPE "link_status_enum" ADD VALUE IF NOT EXISTS 'pending_page';
