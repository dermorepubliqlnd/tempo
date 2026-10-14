-- phase195 (2026-10-14, Sandra): Title Case for template and module task names.
-- Affects tasks created from now on; existing tasks keep their names.

update public.task_templates t set name = v.name
from (values
  ('scoping','1.1','Discovery Call'), ('scoping','1.2','Needs Analysis'), ('scoping','1.2a','Data Gathering'),
  ('scoping','1.2b','Learner Profile'), ('scoping','1.2c','Gap Analysis'), ('scoping','1.3','Scope Statement'),
  ('scoping','1.4','Review Scope'), ('scoping','1.5','Scope Sign-Off'),
  ('delivery','D1','Train-the-Trainer / Facilitator Walkthrough'), ('delivery','D2','Manager and Buddy Briefing'),
  ('delivery','D3','Pilot or Dry Run with Target Learners'), ('delivery','D4','Pilot Fixes'),
  ('delivery','D5','Upload to LMS (Litmos): Learning Path, Enrolment, Assignment Rules, Due Dates'),
  ('delivery','D6','Schedule Batches or Classes with Supervisors'), ('delivery','D7','Launch Comms to Learners and Supervisors'),
  ('delivery','D8','Reminders and Escalation for Overdue Learners'), ('delivery','D9','Monitor Completion (First 2 Weeks)'),
  ('delivery','D10','Hand Over to Training Delivery / Ongoing Container'),
  ('evaluation','E1','L1 Reaction Survey Summary'), ('evaluation','E2','L2 Assessment / Knowledge Check Results'),
  ('evaluation','E3','L3 On-the-Job Check with Supervisors (30 Days)'), ('evaluation','E4','Time-to-Competency Check (30-60-90 Sign-Offs)'),
  ('evaluation','E5','L4 Check: Related KPIs, Deviations or NCR Trend with Quality'), ('evaluation','E6','Audit-Ready Completion Record Export'),
  ('evaluation','E7','Recertification Schedule Set in Litmos'), ('evaluation','E8','Evaluation Report'),
  ('evaluation','E9','Lessons Learned and Close-Out')
) as v(k, r, name)
where t.template_key = v.k and t.ref = v.r;

-- Add module: Title Case step names.
do $$
declare d text := pg_get_functiondef('public.r2_add_module'::regproc);
begin
  d := replace(d, '''Design / storyboard · ''', '''Design / Storyboard · ''');
  d := replace(d, '''Review · design · ''', '''Review · Design · ''');
  d := replace(d, '''Sign-off · design · ''', '''Sign-Off · Design · ''');
  d := replace(d, '''Review · build · ''', '''Review · Build · ''');
  d := replace(d, '''Sign-off · build · ''', '''Sign-Off · Build · ''');
  execute d;
end $$;
