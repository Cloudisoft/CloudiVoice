-- Supervisors can take over a live call; their words are part of the transcript.
alter table transcript_lines drop constraint if exists transcript_lines_speaker_check;
alter table transcript_lines add constraint transcript_lines_speaker_check check (speaker in ('agent','caller','system','supervisor'));
