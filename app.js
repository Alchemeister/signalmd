const PUBMED_SEARCH_URL = "/api/pubmed/search";
const PUBMED_SUMMARY_URL = "/api/pubmed/summary";
const WATCHLIST_KEY = "signalmd.patient.watchlist";
const NOTE_KEY = "signalmd.patient.note";

const form = document.querySelector("#search-form");
const questionInput = document.querySelector("#patient-question");
const topicInput = document.querySelector("#topic");
const notesInput = document.querySelector("#notes");
const evidenceInput = document.querySelector("#evidence");
const dateWindowInput = document.querySelector("#date-window");
const limitInput = document.querySelector("#limit");
const toneInput = document.querySelector("#tone");
const saveNoteButton = document.querySelector("#save-note");
const clearNoteButton = document.querySelector("#clear-note");
const clearWatchlistButton = document.querySelector("#clear-watchlist");
const watchlistItems = document.querySelector("#watchlist-items");
const sourcesPanel = document.querySelector(".sources-panel");
const resultsTitle = document.querySelector("#results-title");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const summaryStrip = document.querySelector("#summary-strip");
const template = document.querySelector("#result-template");
const conversationCard = document.querySelector("#conversation-card");
const copyBriefButton = document.querySelector("#copy-brief");
const printBriefButton = document.querySelector("#print-brief");
const downloadBriefButton = document.querySelector("#download-brief");

let currentResults = [];
let selectedSourceIds = new Set();

const starterTopics = [
  "ApoB cardiovascular risk",
  "Lp(a) cardiovascular risk",
  "coronary artery calcium score risk",
  "fasting insulin cardiometabolic risk",
  "hs-CRP cardiovascular risk",
  "GLP-1 cardiovascular outcomes",
  "statin intolerance management",
  "sleep apnea cardiovascular risk",
  "thyroid symptoms normal TSH",
  "vitamin D deficiency guideline",
];

function getWatchlist() {
  const saved = localStorage.getItem(WATCHLIST_KEY);
  if (!saved) return starterTopics;

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) && parsed.length ? parsed : starterTopics;
  } catch {
    return starterTopics;
  }
}

function setWatchlist(items) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items));
  renderWatchlist();
}

function renderWatchlist() {
  watchlistItems.replaceChildren();
  getWatchlist().forEach((topic) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "topic-chip";
    button.textContent = topic;
    button.addEventListener("click", () => {
      topicInput.value = topic;
      if (!questionInput.value.trim()) {
        questionInput.value = `I have been reading about ${topic}. Is this worth discussing for my situation?`;
      }
      runSearch();
    });
    watchlistItems.append(button);
  });
}

function buildQuery(topic) {
  const evidence = evidenceInput.value;
  const days = Number(dateWindowInput.value);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const yyyy = since.getUTCFullYear();
  const mm = String(since.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(since.getUTCDate()).padStart(2, "0");
  const dateClause = `("${yyyy}/${mm}/${dd}"[Date - Publication] : "3000"[Date - Publication])`;

  const filters = {
    strict: "(guideline[Publication Type] OR practice guideline[Publication Type] OR systematic review[Publication Type] OR meta-analysis[Publication Type] OR randomized controlled trial[Publication Type] OR clinical trial[Publication Type])",
    guidelines: "(guideline[Publication Type] OR practice guideline[Publication Type] OR consensus development conference[Publication Type])",
    reviews: "(systematic review[Publication Type] OR meta-analysis[Publication Type] OR review[Publication Type])",
    trials: "(randomized controlled trial[Publication Type] OR clinical trial[Publication Type] OR controlled clinical trial[Publication Type])",
    observational: "(observational study[Publication Type] OR cohort studies[MeSH Terms] OR prospective studies[MeSH Terms] OR systematic review[Publication Type] OR meta-analysis[Publication Type] OR clinical trial[Publication Type])",
    broad: "",
  };

  const evidenceClause = filters[evidence] ? ` AND ${filters[evidence]}` : "";
  return `(${topic}) AND ${dateClause}${evidenceClause}`;
}

async function runSearch() {
  const topic = topicInput.value.trim();
  if (!topic) return;

  setLoading(true, "Searching PubMed");
  selectedSourceIds = new Set();
  currentResults = [];
  resultsTitle.textContent = topic;
  resultsEl.replaceChildren();
  summaryStrip.hidden = true;
  renderConversationCard();

  try {
    const query = buildQuery(topic);
    const searchResult = await searchPubMed(query, Number(limitInput.value));
    const ids = searchResult.ids;
    if (!ids.length) {
      renderEmpty("No PubMed records matched these filters. Try a broader source strictness or longer time window.");
      setLoading(false, "No records");
      return;
    }

    const summaries = await summarizePubMed(ids);
    currentResults = summaries
      .map((record) => normalizeRecord(record, ids, searchResult.queryTranslation))
      .filter((record) => record.integrity.sourceLocked)
      .sort((a, b) => b.signalScore - a.signalScore);

    autoSelectTopSources();
    renderSummary(currentResults);
    renderResults(currentResults);
    renderConversationCard();
    setLoading(false, `${currentResults.length} source-locked records`);
  } catch (error) {
    currentResults = [];
    renderError(error);
    renderConversationCard();
    setLoading(false, "Search failed");
  }
}

async function searchPubMed(query, limit) {
  const params = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmode: "json",
    retmax: String(limit),
    sort: "pub_date",
  });
  const response = await fetch(`${PUBMED_SEARCH_URL}?${params.toString()}`);
  if (!response.ok) throw new Error(`PubMed search returned ${response.status}`);
  const json = await response.json();
  return {
    ids: json.esearchresult?.idlist || [],
    queryTranslation: json.esearchresult?.querytranslation || query,
  };
}

async function summarizePubMed(ids) {
  const params = new URLSearchParams({
    db: "pubmed",
    id: ids.join(","),
    retmode: "json",
  });
  const response = await fetch(`${PUBMED_SUMMARY_URL}?${params.toString()}`);
  if (!response.ok) throw new Error(`PubMed summary returned ${response.status}`);
  const json = await response.json();
  return (json.result?.uids || []).map((uid) => json.result[uid]).filter(Boolean);
}

function normalizeRecord(record, searchedIds, queryTranslation) {
  const pubtypes = record.pubtype || [];
  const title = cleanText(record.title || "");
  const journal = cleanText(record.fulljournalname || record.source || "");
  const pubdate = cleanText(record.sortpubdate || record.pubdate || "");
  const uid = String(record.uid || "");
  const tags = deriveTags(title, pubtypes, pubdate);
  const grade = deriveGrade(tags);
  const integrity = deriveIntegrity({ uid, title, journal, searchedIds });
  const signalScore = scoreRecord(tags, pubdate, integrity);

  return {
    uid,
    title: title || "Title not available from PubMed summary",
    journal: journal || "Journal not available from PubMed summary",
    pubdate: pubdate || "Date not listed",
    pubtypes,
    tags,
    grade,
    signalScore,
    queryTranslation,
    integrity,
    url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
  };
}

function deriveIntegrity({ uid, title, journal, searchedIds }) {
  const idMatched = searchedIds.includes(uid);
  const hasTitle = Boolean(title);
  const hasJournal = Boolean(journal);
  const hasLink = Boolean(uid);

  return {
    idMatched,
    hasTitle,
    hasJournal,
    hasLink,
    sourceLocked: idMatched && hasTitle && hasLink,
  };
}

function cleanText(value) {
  const div = document.createElement("div");
  div.innerHTML = value;
  return div.textContent.replace(/\s+/g, " ").trim();
}

function deriveTags(title, pubtypes, pubdate) {
  const text = `${title} ${pubtypes.join(" ")}`.toLowerCase();
  const tags = [];

  if (text.includes("practice guideline") || text.includes("guideline") || text.includes("consensus")) tags.push("guideline");
  if (text.includes("meta-analysis")) tags.push("meta-analysis");
  if (text.includes("systematic review")) tags.push("systematic review");
  if (text.includes("randomized") || text.includes("randomised")) tags.push("randomized");
  if (text.includes("clinical trial")) tags.push("clinical trial");
  if (text.includes("cohort")) tags.push("cohort");
  if (text.includes("observational")) tags.push("observational");
  if (text.includes("case report")) tags.push("case report");
  if (isRecent(pubdate, 180)) tags.push("new");
  if (!tags.length) tags.push("metadata only");

  return [...new Set(tags)];
}

function deriveGrade(tags) {
  if (tags.includes("guideline")) return "Guideline";
  if (tags.includes("meta-analysis") || tags.includes("systematic review")) return "Review signal";
  if (tags.includes("randomized") || tags.includes("clinical trial")) return "Trial signal";
  if (tags.includes("cohort")) return "Cohort signal";
  if (tags.includes("observational")) return "Observational";
  if (tags.includes("case report")) return "Low signal";
  return "Metadata only";
}

function scoreRecord(tags, pubdate, integrity) {
  let score = integrity.sourceLocked ? 10 : -100;
  if (tags.includes("guideline")) score += 50;
  if (tags.includes("meta-analysis")) score += 42;
  if (tags.includes("systematic review")) score += 38;
  if (tags.includes("randomized")) score += 32;
  if (tags.includes("clinical trial")) score += 24;
  if (tags.includes("cohort")) score += 14;
  if (tags.includes("observational")) score += 8;
  if (tags.includes("case report")) score -= 12;
  if (isRecent(pubdate, 180)) score += 12;
  if (isRecent(pubdate, 60)) score += 6;
  return score;
}

function isRecent(pubdate, days) {
  const timestamp = Date.parse(pubdate);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}

function autoSelectTopSources() {
  selectedSourceIds = new Set(currentResults.slice(0, 3).map((record) => record.uid));
}

function renderSummary(records) {
  const selected = records.filter((record) => selectedSourceIds.has(record.uid)).length;
  const highSignal = records.filter((record) => ["Guideline", "Review signal", "Trial signal"].includes(record.grade)).length;
  const locked = records.filter((record) => record.integrity.sourceLocked).length;
  const items = [
    ["Retrieved", records.length],
    ["Source locked", locked],
    ["High signal", highSignal],
    ["Selected", selected],
  ];

  summaryStrip.replaceChildren();
  items.forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "summary-item";
    item.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    summaryStrip.append(item);
  });
  summaryStrip.hidden = false;
}

function renderResults(records) {
  resultsEl.replaceChildren();

  if (!records.length) {
    renderEmpty("No source-locked records to show yet.");
    return;
  }

  records.forEach((record) => {
    const node = template.content.cloneNode(true);
    const checkbox = node.querySelector(".source-checkbox");
    checkbox.checked = selectedSourceIds.has(record.uid);
    checkbox.setAttribute("aria-label", `Use ${record.title} in conversation card`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedSourceIds.add(record.uid);
      } else {
        selectedSourceIds.delete(record.uid);
      }
      renderSummary(currentResults);
      renderConversationCard();
    });

    node.querySelector(".pubdate").textContent = record.pubdate.slice(0, 10);
    node.querySelector("h3").textContent = record.title;
    node.querySelector(".journal").textContent = `${record.journal} · PMID ${record.uid}`;

    const tagRow = node.querySelector(".tag-row");
    [record.grade, ...record.tags].forEach((tag) => {
      const pill = document.createElement("span");
      pill.className = "tag";
      pill.textContent = tag;
      tagRow.append(pill);
    });

    const integrityList = node.querySelector(".integrity-list");
    [
      ["PubMed ID matched search", record.integrity.idMatched],
      ["Title returned by summary", record.integrity.hasTitle],
      ["Public source link", record.integrity.hasLink],
    ].forEach(([label, passed]) => {
      const item = document.createElement("span");
      item.className = passed ? "check pass" : "check fail";
      item.textContent = `${passed ? "OK" : "Check"} ${label}`;
      integrityList.append(item);
    });

    const link = node.querySelector("a");
    link.href = record.url;

    node.querySelector(".copy-citation").addEventListener("click", async (event) => {
      await copyText(formatCitation(record));
      event.currentTarget.textContent = "Copied";
      setTimeout(() => {
        event.currentTarget.textContent = "Copy citation";
      }, 1200);
    });

    resultsEl.append(node);
  });
}

function renderConversationCard() {
  const selectedRecords = currentResults.filter((record) => selectedSourceIds.has(record.uid));
  if (!selectedRecords.length) {
    conversationCard.innerHTML = `
      <div class="card-empty">
        Find sources and select one to three records. The card will only use selected, source-locked records.
      </div>
    `;
    return;
  }

  const card = buildConversationCard(selectedRecords);
  conversationCard.innerHTML = `
    <div class="card-header">
      <p class="eyebrow">Appointment question card</p>
      <h3>${escapeHtml(topicInput.value.trim() || "My question")}</h3>
      <p>${escapeHtml(card.opener)}</p>
    </div>

    <section>
      <h4>Questions I can ask</h4>
      <ol>
        ${card.questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}
      </ol>
    </section>

    <section>
      <h4>What this does not prove</h4>
      <ul>
        ${card.notProven.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>

    ${card.notes ? `
      <section>
        <h4>My notes</h4>
        <p>${escapeHtml(card.notes)}</p>
      </section>
    ` : ""}

    <section>
      <h4>Sources I found</h4>
      <div class="source-table">
        ${selectedRecords.map((record, index) => `
          <div class="source-row">
            <span>${index + 1}</span>
            <div>
              <strong>${escapeHtml(record.title)}</strong>
              <p>${escapeHtml(record.journal)}. ${escapeHtml(record.pubdate.slice(0, 10))}. PMID ${escapeHtml(record.uid)}.</p>
              <a href="${record.url}" target="_blank" rel="noopener">${record.url}</a>
            </div>
          </div>
        `).join("")}
      </div>
    </section>

    <footer class="card-footer">
      I am bringing this as a question, not a conclusion. Please tell me whether these sources are relevant to my situation.
    </footer>
  `;
}

function buildConversationCard(selectedRecords) {
  const topic = topicInput.value.trim() || "this topic";
  const patientQuestion = questionInput.value.trim();
  const notes = notesInput.value.trim();
  const tone = toneInput.value;
  const count = selectedRecords.length;

  const openers = {
    calm: `I may be misunderstanding this, but I found ${count} PubMed source${count === 1 ? "" : "s"} about ${topic}. Could we talk about whether this is relevant to me?`,
    concise: `I found ${count} PubMed source${count === 1 ? "" : "s"} about ${topic}. Is this relevant to my situation, or is it not something I should focus on?`,
    curious: `I am trying to understand ${topic} without overreacting. I found ${count} PubMed source${count === 1 ? "" : "s"} and wanted to ask how you would interpret this for someone like me.`,
  };

  const baseQuestion = patientQuestion
    ? `My question in plain language: ${patientQuestion}`
    : `My question in plain language: Is ${topic} worth discussing for my situation?`;

  return {
    opener: `${openers[tone]} ${baseQuestion}`,
    notes,
    questions: [
      `Does this evidence apply to someone with my age, history, labs, symptoms, medications, and risk factors?`,
      `Is there a guideline-supported test, follow-up, or next question that would help decide whether this matters for me?`,
      `What would make these sources less relevant or not useful in my case?`,
      `Are there better sources or guidelines you would trust more on this topic?`,
    ],
    notProven: [
      "This does not diagnose me with a condition.",
      "This does not mean I should start, stop, or change medication.",
      "This does not prove that a test or treatment is appropriate for me.",
      "The studies may involve people who are different from me.",
      "A doctor or qualified medical professional should interpret this in context.",
    ],
  };
}

function getBriefText() {
  const selectedRecords = currentResults.filter((record) => selectedSourceIds.has(record.uid));
  if (!selectedRecords.length) return "";
  const card = buildConversationCard(selectedRecords);

  return [
    `SignalMD appointment question card`,
    ``,
    `Topic: ${topicInput.value.trim() || "My question"}`,
    ``,
    card.opener,
    ``,
    `Questions I can ask:`,
    ...card.questions.map((question, index) => `${index + 1}. ${question}`),
    ``,
    `What this does not prove:`,
    ...card.notProven.map((item) => `- ${item}`),
    card.notes ? `\nMy notes:\n${card.notes}` : "",
    ``,
    `Sources I found:`,
    ...selectedRecords.map((record, index) => `${index + 1}. ${formatCitation(record)}`),
    ``,
    `I am bringing this as a question, not a conclusion. Please tell me whether these sources are relevant to my situation.`,
  ].filter(Boolean).join("\n");
}

function renderEmpty(message) {
  resultsEl.replaceChildren();
  const div = document.createElement("div");
  div.className = "empty-state";
  div.textContent = message;
  resultsEl.append(div);
}

function renderError(error) {
  resultsEl.replaceChildren();
  const div = document.createElement("div");
  div.className = "error-state";
  div.textContent = `Could not retrieve PubMed data. ${error.message}.`;
  resultsEl.append(div);
}

function setLoading(isLoading, label) {
  sourcesPanel.setAttribute("aria-busy", String(isLoading));
  statusEl.textContent = label;
  form.querySelectorAll("button, input, select, textarea").forEach((element) => {
    element.disabled = isLoading;
  });
}

function formatCitation(record) {
  return `${record.title} ${record.journal}. ${record.pubdate}. PMID ${record.uid}. ${record.url}`;
}

async function copyText(text) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

function downloadBrief() {
  const text = getBriefText();
  if (!text) return;

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `signalmd-question-card-${Date.now()}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});

saveNoteButton.addEventListener("click", () => {
  localStorage.setItem(NOTE_KEY, JSON.stringify({
    question: questionInput.value,
    topic: topicInput.value,
    notes: notesInput.value,
    tone: toneInput.value,
  }));
  saveNoteButton.textContent = "Saved";
  setTimeout(() => {
    saveNoteButton.textContent = "Save local note";
  }, 1200);
});

clearNoteButton.addEventListener("click", () => {
  localStorage.removeItem(NOTE_KEY);
  questionInput.value = "";
  topicInput.value = "";
  notesInput.value = "";
  selectedSourceIds = new Set();
  currentResults = [];
  resultsTitle.textContent = "No source selected yet";
  summaryStrip.hidden = true;
  renderEmpty("Your note is clear. Enter a question and search for sources when ready.");
  renderConversationCard();
});

clearWatchlistButton.addEventListener("click", () => {
  setWatchlist(starterTopics);
});

copyBriefButton.addEventListener("click", async () => {
  await copyText(getBriefText());
  copyBriefButton.textContent = "Copied";
  setTimeout(() => {
    copyBriefButton.textContent = "Copy card";
  }, 1200);
});

printBriefButton.addEventListener("click", () => {
  window.print();
});

downloadBriefButton.addEventListener("click", downloadBrief);

[questionInput, topicInput, notesInput, toneInput].forEach((input) => {
  input.addEventListener("input", renderConversationCard);
});

const savedNote = localStorage.getItem(NOTE_KEY);
if (savedNote) {
  try {
    const note = JSON.parse(savedNote);
    questionInput.value = note.question || questionInput.value;
    topicInput.value = note.topic || topicInput.value;
    notesInput.value = note.notes || "";
    toneInput.value = note.tone || toneInput.value;
  } catch {
    localStorage.removeItem(NOTE_KEY);
  }
}

renderWatchlist();
renderEmpty("Enter a question and find sources. Results will appear here with PubMed links and integrity checks.");
renderConversationCard();

const initialParams = new URLSearchParams(window.location.search);
const initialTopic = initialParams.get("q");
if (initialTopic) {
  topicInput.value = initialTopic;
  runSearch();
}
