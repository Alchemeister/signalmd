# SignalMD

SignalMD is a source-first research radar for clinicians. The first version is a static web app that searches PubMed, displays retrieved source metadata, ranks records with transparent rules, and saves clinician watchlist topics in the browser.

## What it is

- A live PubMed search interface for followed clinical topics.
- A saved watchlist for topics such as ApoB, Lp(a), GLP-1 outcomes, statin intolerance, and specialty-specific research areas.
- A deterministic evidence signal layer based on publication type, recency, and title metadata.
- A public website surface that explains the trust boundary and go-to-market promise.

## What it is not

- It is not a diagnostic tool.
- It is not a prescribing tool.
- It does not generate clinical recommendations.
- It does not summarize findings as fact unless a retrieved source supports the displayed metadata.

## Run locally

Open `index.html` in a browser, or serve the folder with any static file server:

```powershell
npx serve .
```

The app calls the public NCBI E-utilities endpoints from the browser:

- `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi`
- `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi`

## Evidence scoring

The first scoring layer is intentionally simple and inspectable:

- Guidelines, meta-analyses, systematic reviews, and randomized trials receive higher signal scores.
- Cohort and observational signals are labeled separately.
- Case reports are demoted.
- Recent records receive an additional freshness boost.

This is not a final evidence-grading engine. Production versions should integrate guideline sources, retraction checks, trial registry matching, conflict-of-interest extraction, specialty ontologies, and human clinical review.

## Launch wedge

Start with clinicians who already care about staying current:

- Lipidology and preventive cardiology
- Cardiometabolic and endocrinology practices
- Oncology specialists
- Psychiatry practices tracking fast-moving evidence
- Longevity and high-end primary care clinics

## Near-term roadmap

1. Add email capture and founding clinician onboarding.
2. Add topic folders by specialty.
3. Add weekly digest generation from retrieved source records only.
4. Add Cochrane, ClinicalTrials.gov, FDA safety communications, and society guideline feeds.
5. Add retraction and correction checks.
6. Add clinician-reviewed evidence profiles.
7. Add paid seats for private practice groups.
