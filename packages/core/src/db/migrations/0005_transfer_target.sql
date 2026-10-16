-- Where a live call is being handed over to, set just before the AI stream stops.
alter table calls add column if not exists transfer_to text;
alter table calls add column if not exists transfer_caller_id text;
