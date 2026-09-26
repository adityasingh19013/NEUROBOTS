"""Fallback metric definitions, used when sample_data/metric_definitions.json is missing or has no 'calc' blocks."""

DEFAULT_METRICS = [
    {"code": "M1", "name": "Unique beneficiaries enrolled", "unit": "people",
     "definition": "Count of distinct people in the intake file after duplicate merging, with an enrollment date "
                   "inside the reporting period.",
     "calc": {"type": "count_distinct_people", "role": "beneficiary registry", "filters": {"period": True}},
     "caveat": "People with a missing or out-of-period enrollment date are listed as excluded, not guessed."},
    {"code": "M2", "name": "Active participants", "unit": "people",
     "definition": "Unique enrolled beneficiaries with at least 2 sessions marked present.",
     "calc": {"type": "people_with_min_events", "base": "M3", "min_events": 2}},
    {"code": "M3", "name": "Total session attendances", "unit": "attendances",
     "definition": "Count of attendance rows marked present, matched to an enrolled beneficiary, after removing "
                   "exact duplicate rows.",
     "calc": {"type": "count_rows", "role": "attendance", "filters": {"attended": True, "linked": True}}},
    {"code": "M4", "name": "Average confidence gain", "unit": "points on 1-5 scale",
     "definition": "Mean of (Confidence After - Confidence Before) across matched survey respondents with both "
                   "scores valid (1-5). If a person has several surveys, use the latest one.",
     "calc": {"type": "mean_difference", "role": "survey", "field_a": "score_after", "field_b": "score_before",
              "valid_range": [1, 5], "latest_per_person": True, "filters": {"linked": True}},
     "caveat": "Self-reported and not a control-group comparison; shows reported change, not proven program impact."},
    {"code": "M5", "name": "Survey response rate", "unit": "percent",
     "definition": "Number of M1 beneficiaries with at least one valid survey response, divided by M1.",
     "calc": {"type": "ratio", "denominator": "M1",
              "numerator": {"type": "count_distinct_people", "role": "survey",
                            "filters": {"linked": True, "people_in": "M1"}}}},
]
