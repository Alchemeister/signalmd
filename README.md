# SignalMD

SignalMD is a patient-first evidence prep tool. It helps people bring calm, source-backed questions to a doctor visit without generating medical advice.

## Product rule

No source, no claim.

The MVP only displays retrieved PubMed metadata: title, journal, publication date, publication type tags, PMID, and source links. The appointment card is generated from templates and selected PubMed records. It does not summarize study findings, diagnose, prescribe, or tell a patient what to do.

## Who it is for

The first wedge is the health optimizer: people who track labs, read about markers, and want to ask better questions without sounding like they outsourced their appointment to a chatbot.

The product should still work for all patients because the core workflow is broad:

1. Write the real question.
2. Search for credible sources.
3. Select one to three sources.
4. Bring a short conversation card to the doctor.

## What the app creates

- A patient-sounding opener.
- Doctor-facing questions.
- A "what this does not prove" section.
- Optional private notes stored only in the browser.
- A source table with PMID and PubMed links.

## Source integrity checks

Every source card shows:

- PubMed ID matched the search result.
- Title returned by the PubMed summary endpoint.
- Public PubMed source link exists.

Records that fail source-lock checks are not used in the conversation card.

## Run locally

```powershell
node server.mjs
```

Then open:

```text
http://127.0.0.1:4177
```

You can auto-run a search:

```text
http://127.0.0.1:4177/?q=ApoB%20cardiovascular%20risk
```

## Data handling

The MVP has no account system and no database. Private notes are stored in `localStorage` in the user's browser. PubMed searches are sent to NCBI E-utilities.

## Production roadmap

1. Add plain-language source summaries only when every sentence is citation-bound.
2. Add source redundancy: PubMed, guideline sources, ClinicalTrials.gov, FDA safety communications, and retraction checks.
3. Add clinician review workflows for high-use topics.
4. Add account login only after privacy, security, and legal review.
5. Add export formats for patient portal messages and printable appointment prep.
6. Add topic-specific guardrails for medications, pregnancy, cancer, mental health, emergencies, and pediatrics.

## Safety boundary

SignalMD is educational appointment-prep software. It should always refer users to a medical professional for diagnosis, treatment decisions, medication changes, and interpretation of personal health information.
