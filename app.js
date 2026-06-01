const PUBMED_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_SUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const WATCHLIST_KEY = "signalmd.watchlist";

const form = document.querySelector("#search-form");
const topicInput = document.querySelector("#topic");
const specialtyInput = document.querySelector("#specialty");
const evidenceInput = document.querySelector("#evidence");
const dateWindowInput = document.querySelector("#date-window");
const limitInput = document.querySelector("#limit");
const saveTopicButton = document.querySelector("#save-topic");
const exportButton = document.querySelector("#export-csv");
const clearWatchlistButton = document.querySelector("#clear-watchlist");
const watchlistItems = document.querySelector("#watchlist-items");
const resultsPanel = document.querySelector(".results-panel");
const resultsTitle = document.querySelector("#results-title");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const summaryStrip = document.querySelector("#summary-strip");
const template = document.querySelector("#result-template");

let currentResults = [];

const starterTopics = [
  "ApoB cardiovascular risk",
  "Lp(a) therapy",
  "triglyceride rich lipoproteins",
  "GLP-1 cardiovascular outcomes",
  "statin intolerance",
];

function getWatchlist() {
  const saved = localStorage.getItem(WATCHLIST_KEY);
  if (!saved) return starterTopics;

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : starterTopics;
  } catch {
    return starterTopics;
  }
}

function setWatchlist(items) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items));
  renderWatchlist();
}

function renderWatchlist() {
  const topics = getWatchlist();
  watchlistItems.replaceChildren();

  topics.forEach((topic) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "topic-chip";
    button.textContent = topic;
    button.addEventListener("click", () => {
      topicInput.value = topic;
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
    high: "(systematic review[Publication Type] OR meta-analysis[Publication Type] OR randomized controlled trial[Publication Type] OR guideline[Publication Type] OR clinical trial[Publication Type])",
    reviews: "(systematic review[Publication Type] OR meta-analysis[Publication Type] OR review[Publication Type])",
    trials: "(randomized controlled trial[Publication Type] OR clinical trial[Publication Type] OR controlled clinical trial[Publication Type])",
    guidelines: "(guideline[Publication Type] OR practice guideline[Publication Type] OR consensus development conference[Publication Type])",
    broad: "",
  };

  const specialty = specialtyInput.value ? ` AND ${specialtyInput.value}` : "";
  const evidenceClause = filters[evidence] ? ` AND ${filters[evidence]}` : "";
  return `(${topic}${specialty}) AND ${dateClause}${evidenceClause}`;
}

async function runSearch() {
  const topic = topicInput.value.trim();
  if (!topic) return;

  setLoading(true, "Searching PubMed");
  resultsTitle.textContent = topic;
  resultsEl.replaceChildren();
  summaryStrip.hidden = true;

  try {
    const query = buildQuery(topic);
    const ids = await searchPubMed(query, Number(limitInput.value));
    if (!ids.length) {
      currentResults = [];
      renderEmpty("No matching PubMed records found for this filter set. Try a broader evidence lens or longer time window.");
      setLoading(false, "No records");
      return;
    }

    const records = await summarizePubMed(ids);
    currentResults = records.map(normalizeRecord).sort((a, b) => b.signalScore - a.signalScore);
    renderSummary(currentResults);
    renderResults(currentResults);
    setLoading(false, `${currentResults.length} records`);
  } catch (error) {
    currentResults = [];
    renderError(error);
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
  return json.esearchresult?.idlist || [];
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

function normalizeRecord(record) {
  const pubtypes = record.pubtype || [];
  const title = cleanText(record.title || "Untitled PubMed record");
  const journal = cleanText(record.fulljournalname || record.source || "Journal not listed");
  const pubdate = cleanText(record.sortpubdate || record.pubdate || "Date not listed");
  const tags = deriveTags(title, pubtypes, pubdate);
  const grade = deriveGrade(tags);
  const signalScore = scoreRecord(tags, pubdate);

  return {
    uid: record.uid,
    title,
    journal,
    pubdate,
    pubtypes,
    tags,
    grade,
    signalScore,
    url: `https://pubmed.ncbi.nlm.nih.gov/${record.uid}/`,
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

  if (text.includes("meta-analysis")) tags.push("meta-analysis");
  if (text.includes("systematic review")) tags.push("systematic review");
  if (text.includes("randomized") || text.includes("randomised")) tags.push("randomized");
  if (text.includes("clinical trial")) tags.push("clinical trial");
  if (text.includes("guideline") || text.includes("consensus")) tags.push("guideline");
  if (text.includes("cohort")) tags.push("cohort");
  if (text.includes("observational")) tags.push("observational");
  if (text.includes("case report")) tags.push("case report");
  if (isRecent(pubdate, 180)) tags.push("new");
  if (!tags.length) tags.push("metadata only");

  return [...new Set(tags)];
}

function deriveGrade(tags) {
  if (tags.includes("guideline")) return "Guideline";
  if (tags.includes("meta-analysis") || tags.includes("systematic review")) return "High signal";
  if (tags.includes("randomized") || tags.includes("clinical trial")) return "Trial signal";
  if (tags.includes("cohort")) return "Cohort signal";
  if (tags.includes("case report")) return "Low signal";
  return "Needs review";
}

function scoreRecord(tags, pubdate) {
  let score = 10;
  if (tags.includes("guideline")) score += 45;
  if (tags.includes("meta-analysis")) score += 40;
  if (tags.includes("systematic review")) score += 35;
  if (tags.includes("randomized")) score += 32;
  if (tags.includes("clinical trial")) score += 24;
  if (tags.includes("cohort")) score += 14;
  if (tags.includes("observational")) score += 8;
  if (tags.includes("case report")) score -= 8;
  if (isRecent(pubdate, 180)) score += 16;
  if (isRecent(pubdate, 60)) score += 8;
  return score;
}

function isRecent(pubdate, days) {
  const timestamp = Date.parse(pubdate);
  if (Number.isNaN(timestamp)) return false;
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}

function renderSummary(records) {
  const highSignal = records.filter((record) => ["Guideline", "High signal", "Trial signal"].includes(record.grade)).length;
  const newest = records[0]?.pubdate || "n/a";
  const linked = records.length;
  const items = [
    ["Retrieved", linked],
    ["High signal", highSignal],
    ["Newest", newest.slice(0, 10)],
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

  records.forEach((record) => {
    const node = template.content.cloneNode(true);
    node.querySelector(".grade").textContent = record.grade;
    node.querySelector(".pubdate").textContent = record.pubdate.slice(0, 10);
    node.querySelector("h3").textContent = record.title;
    node.querySelector(".journal").textContent = record.journal;

    const tagRow = node.querySelector(".tag-row");
    record.tags.forEach((tag) => {
      const pill = document.createElement("span");
      pill.className = "tag";
      pill.textContent = tag;
      tagRow.append(pill);
    });

    const link = node.querySelector("a");
    link.href = record.url;
    link.textContent = "Open PubMed";

    node.querySelector(".copy-citation").addEventListener("click", async (event) => {
      await copyCitation(record);
      event.currentTarget.textContent = "Copied";
      setTimeout(() => {
        event.currentTarget.textContent = "Copy citation";
      }, 1200);
    });

    resultsEl.append(node);
  });
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
  resultsPanel.setAttribute("aria-busy", String(isLoading));
  statusEl.textContent = label;
  form.querySelectorAll("button, input, select").forEach((element) => {
    element.disabled = isLoading;
  });
}

async function copyCitation(record) {
  const citation = `${record.title} ${record.journal}. ${record.pubdate}. ${record.url}`;
  await navigator.clipboard.writeText(citation);
}

function exportCsv() {
  if (!currentResults.length) return;

  const rows = [
    ["grade", "date", "journal", "title", "pubmed_url", "tags"],
    ...currentResults.map((record) => [
      record.grade,
      record.pubdate,
      record.journal,
      record.title,
      record.url,
      record.tags.join("; "),
    ]),
  ];
  const csv = rows
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `signalmd-${Date.now()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});

saveTopicButton.addEventListener("click", () => {
  const topic = topicInput.value.trim();
  if (!topic) return;
  const topics = getWatchlist();
  if (!topics.some((item) => item.toLowerCase() === topic.toLowerCase())) {
    setWatchlist([topic, ...topics].slice(0, 18));
  }
});

clearWatchlistButton.addEventListener("click", () => {
  setWatchlist([]);
});

exportButton.addEventListener("click", exportCsv);

renderWatchlist();
renderEmpty("Run a search or pick a watchlist topic. Results will appear here with source links and ranking tags.");

const initialParams = new URLSearchParams(window.location.search);
const initialTopic = initialParams.get("q");
if (initialTopic) {
  topicInput.value = initialTopic;
  runSearch();
}
