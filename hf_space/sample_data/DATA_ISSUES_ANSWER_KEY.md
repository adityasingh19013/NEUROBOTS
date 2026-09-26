# Sample Data – Planted Issues & Expected Results

All records are **synthetic** (fictional org "Sahay Community Foundation", fake phone numbers `90000xxxxx`). Use this file to test that the app detects every issue and to check the final numbers in the demo.

## The 3 input files

| File | Format | Rows | Key columns |
|---|---|---|---|
| `1_beneficiaries_intake.xlsx` | Excel | 25 | Beneficiary ID, Full Name, Gender, Age, Phone, Village, Enrollment Date, Program |
| `2_attendance_records.csv` | CSV | 24 | participant_name, ph_no, session_date, session_topic, present |
| `3_survey_responses.csv` | CSV | 12 | Name, Mobile, Date of Survey, Confidence Before (1-5), Confidence After (1-5), Would Recommend |

## Column mapping the app should propose

| Canonical field | Intake (xlsx) | Attendance (csv) | Survey (csv) |
|---|---|---|---|
| `full_name` | Full Name | participant_name | Name |
| `phone` | Phone | ph_no | Mobile |
| `event_date` | Enrollment Date | session_date | Date of Survey |

## Planted issues (checklist)

| # | File | Row(s) | Issue type | Detail | Expected handling |
|---|---|---|---|---|---|
| 1 | Intake | BEN-001 & BEN-008 | Duplicate | Same person: trailing space in name, phone `90000 00101` | Suggest merge (phone exact + name match) |
| 2 | Intake | BEN-002 & BEN-015 | Duplicate | `RAHUL VERMA` vs `rahul verma`, dates `12/01/2026` vs `2026-01-12` | Suggest merge |
| 3 | Intake | BEN-005, BEN-013 | Missing value | Enrollment Date blank | Flag, count as "date unknown", don't guess |
| 4 | Intake | BEN-009 | Missing value | Phone blank | Flag; match on name + village only (lower confidence) |
| 5 | Intake | BEN-010, BEN-023 | Missing value | Age blank (BEN-023 also Gender blank) | Flag |
| 6 | Intake | BEN-017 | Invalid value | Age = 250 | Flag as out of range (0–120) |
| 7 | Intake | BEN-019 | Invalid value | Enrollment Date 2027 (in the future) | Flag, exclude from period |
| 8 | Intake | many | Inconsistent format | Gender `F/Female/female/M/Male` | Standardise → `Female/Male/Unknown` |
| 9 | Intake | many | Inconsistent case | `anita das`, `sitapur`, `KALINAGAR`, `Digital literacy` | Standardise to Title Case |
| 10 | Intake | several | Inconsistent format | Dates `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY` | Parse to ISO `YYYY-MM-DD` (assume day-first, log assumption) |
| 11 | Intake | BEN-003 | Inconsistent format | Phone `+91 90000 00103` | Normalise to 10 digits |
| 12 | Attendance | Priya 2026-02-09 | Exact duplicate row | Row repeated twice | Remove one, log it |
| 13 | Attendance | Kavita Nair | Missing value | session_date blank | Keep, flag |
| 14 | Attendance | Deepak Kumar | Missing value | ph_no blank | Match by name only (flag low confidence) |
| 15 | Attendance | Ramesh Gupta | Unmatched record | Not in intake | Show as "unmatched", not counted |
| 16 | Attendance | Rekha Pillai | Invalid value | present = `maybe` | Flag, not counted |
| 17 | Attendance | many | Inconsistent format | present = `Y/yes/1/N/no` | Standardise → true/false |
| 18 | Attendance | Anita Das | Inconsistent format | Phone `919000000103` (country code) | Normalise |
| 19 | Survey | Sunita Devi | Missing value | Date of Survey blank | Flag |
| 20 | Survey | Arjun Patel | Missing value | Confidence After blank | Exclude from M4, show count |
| 21 | Survey | Pooja Singh | Invalid value | Confidence After = 7 (scale 1–5) | Exclude from M4, flag |
| 22 | Survey | Priya Sharma ×2 | Conflicting records | Two surveys, After = 4 and 5 | Use latest (per metric rule), log choice |
| 23 | Survey | Would Recommend | Inconsistent format | `Yes/yes/Y/No/Not sure` | Standardise |

## Expected metric results (using `metric_definitions.json`)

| Metric | Expected value | How it is derived |
|---|---|---|
| **M1** Unique beneficiaries enrolled | **20** | 25 rows − 2 duplicates = 23 unique people; 2 have no enrollment date and 1 has a future date → shown separately as "3 need review" |
| **M2** Active participants (≥2 sessions) | **3** | Priya Sharma, Rahul Verma, Anita Das |
| **M3** Total session attendances | **19** | 24 rows − 1 exact duplicate − 3 not present/invalid (N, no, maybe) − 1 unmatched (Ramesh) |
| **M4** Avg confidence gain | **+1.89** (17 ÷ 9) | 11 unique respondents; Arjun (missing) and Pooja (invalid) excluded → 9 valid |
| **M5** Survey response rate | **50%** (10 ÷ 20) | 11 respondents, but Sunita Devi is not in M1 (no enrollment date) |

A different but **documented** decision (e.g. counting unknown-date beneficiaries in M1) is acceptable – the point is that the report shows the rule and the numbers trace back to rows.
