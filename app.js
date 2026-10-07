const PAGE_SIZE = 24;
const PALETTE = ["#6e2f2a", "#1f3d36", "#2d3d55", "#6b4518", "#3d2a40", "#1d3e48", "#3e3a28", "#4a3028"];
const LANGUAGES = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  cn: "Chinese",
  hi: "Hindi",
  ru: "Russian",
  pt: "Portuguese",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  nl: "Dutch",
  pl: "Polish",
  ar: "Arabic",
  th: "Thai",
  tr: "Turkish",
  he: "Hebrew",
  fa: "Persian",
  id: "Indonesian",
  cs: "Czech",
  hu: "Hungarian",
  fi: "Finnish",
  el: "Greek",
  ro: "Romanian",
  ta: "Tamil",
  te: "Telugu",
};

const state = {
  movies: [],
  query: "",
  genre: "",
  decade: "",
  minRating: 0,
  sort: "popular",
  shown: PAGE_SIZE,
  activeId: null,
};

const els = {
  q: document.querySelector("#q"),
  genreChips: document.querySelector("#genre-chips"),
  sort: document.querySelector("#sort"),
  decade: document.querySelector("#decade"),
  rating: document.querySelector("#rating"),
  clear: document.querySelector("#clear"),
  status: document.querySelector("#status"),
  results: document.querySelector("#results"),
  more: document.querySelector("#more"),
  detail: document.querySelector("#detail"),
  detailBody: document.querySelector("#detail-body"),
  close: document.querySelector("#close-detail"),
};

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 33 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function initials(title) {
  const words = title.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const letters = (words[0]?.[0] || "") + (words[1]?.[0] || "");
  return (letters || title.slice(0, 2)).toUpperCase();
}

function money(value) {
  if (!value) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  return `$${value.toLocaleString()}`;
}

function runtimeLabel(minutes) {
  if (!minutes) return "—";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins}m`;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function languageLabel(code) {
  if (!code) return "—";
  return LANGUAGES[code] || code.toUpperCase();
}

function ratingLabel(movie) {
  if (movie.voteAverage == null) return "—";
  return Number(movie.voteAverage).toFixed(1);
}

function normalize(value) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function prepare(movies) {
  for (const movie of movies) {
    movie.genres = movie.genres || [];
    movie.companies = movie.companies || [];
    movie.title = movie.title || "";
    movie.originalTitle = movie.originalTitle || "";
    movie.director = movie.director || "";
    movie.cast = movie.cast || "";
    movie.overview = movie.overview || "";
    movie.tagline = movie.tagline || "";
    movie.voteCount = movie.voteCount || 0;
    movie.searchTitle = normalize(movie.title);
    movie.searchOriginal = normalize(movie.originalTitle);
    movie.searchDirector = normalize(movie.director);
    movie.searchCast = normalize(movie.cast);
    movie.searchGenres = normalize(movie.genres.join(" "));
    movie.searchText = normalize(
      [movie.overview, movie.tagline, movie.companies.join(" ")].filter(Boolean).join(" "),
    );
  }
  return movies;
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  state.query = params.get("q") || "";
  state.genre = params.get("genre") || "";
  state.decade = params.get("decade") || "";
  state.minRating = Number(params.get("rating") || 0);
  state.sort = params.get("sort") || (state.query ? "relevance" : "popular");
  els.q.value = state.query;
  els.sort.value = state.sort;
  els.decade.value = state.decade;
  els.rating.value = String(state.minRating);
}

function writeUrl() {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.genre) params.set("genre", state.genre);
  if (state.decade) params.set("decade", state.decade);
  if (state.minRating) params.set("rating", String(state.minRating));
  if (state.sort && state.sort !== "popular") params.set("sort", state.sort);
  const next = params.toString();
  history.replaceState(null, "", next ? `?${next}` : location.pathname);
}

function filtersActive() {
  return Boolean(state.query || state.genre || state.decade || state.minRating || state.sort === "relevance");
}

function matches(movie, tokens) {
  if (state.genre && !movie.genres.includes(state.genre)) return null;
  if (state.decade) {
    const start = Number(state.decade);
    if (!movie.year || movie.year < start || movie.year >= start + 10) return null;
  }
  if (state.minRating && (movie.voteAverage || 0) < state.minRating) return null;
  if (!tokens.length) return { movie, score: 0 };

  let score = 0;
  for (const token of tokens) {
    if (movie.searchTitle === tokens.join(" ")) score += 120;
    if (movie.searchTitle.startsWith(token)) score += 36;
    else if (movie.searchTitle.includes(token)) score += 24;
    else if (movie.searchDirector.includes(token)) score += 18;
    else if (movie.searchCast.includes(token)) score += 14;
    else if (movie.searchGenres.includes(token)) score += 10;
    else if (movie.searchOriginal.includes(token)) score += 8;
    else if (movie.searchText.includes(token)) score += 4;
    else return null;
    score += 1;
  }
  return { movie, score };
}

function compare(a, b) {
  const left = a.movie;
  const right = b.movie;
  switch (state.sort) {
    case "relevance":
      return b.score - a.score || (right.voteCount || 0) - (left.voteCount || 0);
    case "rating":
      return (right.voteAverage || 0) - (left.voteAverage || 0) || (right.voteCount || 0) - (left.voteCount || 0);
    case "newest":
      return (right.year || 0) - (left.year || 0) || right.title.localeCompare(left.title);
    case "oldest":
      return (left.year || 9999) - (right.year || 9999) || left.title.localeCompare(right.title);
    case "title":
      return left.title.localeCompare(right.title);
    default:
      return (right.voteCount || 0) - (left.voteCount || 0);
  }
}

function currentResults() {
  const tokens = normalize(state.query).split(/\s+/).filter((token) => token.length > 1 || /^\d$/.test(token));
  return state.movies
    .map((movie) => matches(movie, tokens))
    .filter(Boolean)
    .sort(compare);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text, query) {
  const fragment = document.createDocumentFragment();
  const tokens = query.trim().split(/\s+/).filter((token) => token.length > 1);
  if (!text || !tokens.length) {
    fragment.append(document.createTextNode(text || ""));
    return fragment;
  }
  const pattern = new RegExp(tokens.map(escapeRegExp).join("|"), "ig");
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    fragment.append(document.createTextNode(text.slice(cursor, start)));
    const mark = document.createElement("mark");
    mark.textContent = match[0];
    fragment.append(mark);
    cursor = start + match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(cursor)));
  return fragment;
}

function renderCard(movie) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card";
  button.addEventListener("click", () => openDetail(movie));

  const swatch = document.createElement("div");
  swatch.className = "swatch";
  swatch.style.setProperty("--swatch", PALETTE[hashString(movie.title) % PALETTE.length]);
  const mono = document.createElement("span");
  mono.className = "mono";
  mono.textContent = initials(movie.title);
  swatch.append(mono);
  if (movie.poster) {
    const image = document.createElement("img");
    image.src = movie.poster;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove());
    swatch.append(image);
  }

  const body = document.createElement("div");
  body.className = "card-body";

  const meta = document.createElement("p");
  meta.className = "card-meta";
  const year = document.createElement("span");
  year.textContent = movie.year || "Undated";
  const score = document.createElement("span");
  score.className = "score";
  score.textContent = ratingLabel(movie);
  meta.append(year, score);

  const title = document.createElement("h2");
  title.append(highlight(movie.title, state.query));

  const director = document.createElement("p");
  director.className = "director";
  director.append(highlight(movie.director || "Director unknown", state.query));

  const genres = document.createElement("p");
  genres.className = "genres";
  genres.textContent = movie.genres.join(" · ") || "Unclassified";

  const overview = document.createElement("p");
  overview.className = "overview";
  overview.textContent = movie.overview || "No synopsis in the archive.";

  body.append(meta, title, director, genres, overview);
  button.append(swatch, body);
  return button;
}

function render() {
  const results = currentResults();
  const visible = results.slice(0, state.shown);
  els.results.replaceChildren();

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const title = document.createElement("strong");
    title.textContent = "Nothing under that title";
    const copy = document.createElement("p");
    copy.textContent = "Try a director, an actor, or a single genre word.";
    empty.append(title, copy);
    els.results.append(empty);
  } else {
    const fragment = document.createDocumentFragment();
    for (const item of visible) fragment.append(renderCard(item.movie));
    els.results.append(fragment);
  }

  const noun = results.length === 1 ? "film" : "films";
  if (!state.movies.length) {
    els.status.textContent = "Loading the archive…";
  } else if (!results.length) {
    els.status.textContent = `0 ${noun}`;
  } else {
    els.status.textContent = `Showing ${visible.length} of ${results.length.toLocaleString()} ${noun}`;
  }

  els.more.hidden = visible.length >= results.length;
  els.clear.hidden = !filtersActive();
  syncGenreChips();
  if (state.activeId != null) {
    const movie = state.movies.find((item) => item.id === state.activeId);
    if (movie) fillDetail(movie);
  }
}

function paintGenreChips() {
  const chips = [{ label: "All", value: "" }, ...collectGenres().map((genre) => ({ label: genre, value: genre }))];
  els.genreChips.replaceChildren();
  for (const chip of chips) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.dataset.genre = chip.value;
    button.textContent = chip.label;
    button.addEventListener("click", () => {
      state.genre = chip.value;
      state.shown = PAGE_SIZE;
      writeUrl();
      render();
    });
    els.genreChips.append(button);
  }
  syncGenreChips();
}

function syncGenreChips() {
  if (!els.genreChips.childElementCount) return;
  for (const button of els.genreChips.querySelectorAll(".chip")) {
    button.setAttribute("aria-pressed", String(button.dataset.genre === state.genre));
  }
}

function collectGenres() {
  const counts = new Map();
  for (const movie of state.movies) {
    for (const genre of movie.genres) counts.set(genre, (counts.get(genre) || 0) + 1);
  }
  return [...counts.keys()]
    .filter((genre) => counts.get(genre) >= 30)
    .sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
}

function fillDecades() {
  const years = state.movies.map((movie) => movie.year).filter(Boolean);
  if (!years.length) return;
  const start = Math.floor(Math.min(...years) / 10) * 10;
  const end = Math.floor(Math.max(...years) / 10) * 10;
  for (let decade = end; decade >= start; decade -= 10) {
    const option = document.createElement("option");
    option.value = String(decade);
    option.textContent = `${decade}s`;
    els.decade.append(option);
  }
  els.decade.value = state.decade;
}

function fact(label, value) {
  const wrap = document.createElement("div");
  const caption = document.createElement("span");
  caption.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  wrap.append(caption, strong);
  return wrap;
}

function fillDetail(movie) {
  const body = els.detailBody;
  body.replaceChildren();

  const hero = document.createElement("div");
  hero.className = "detail-hero";
  if (movie.poster) {
    const image = document.createElement("img");
    image.className = "detail-poster";
    image.src = movie.poster;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove());
    hero.append(image);
  }

  const copy = document.createElement("div");
  const kicker = document.createElement("p");
  kicker.className = "detail-kicker";
  kicker.textContent = [movie.year || "Undated", movie.certificate || "", movie.status && movie.status !== "Released" ? movie.status : ""]
    .filter(Boolean)
    .join(" · ");

  const title = document.createElement("h2");
  title.textContent = movie.title;
  copy.append(kicker, title);
  hero.append(copy);
  body.append(hero);

  if (movie.originalTitle && normalize(movie.originalTitle) !== normalize(movie.title)) {
    const original = document.createElement("p");
    original.className = "director";
    original.textContent = movie.originalTitle;
    copy.append(original);
  }

  if (movie.tagline) {
    const tagline = document.createElement("p");
    tagline.className = "tagline";
    tagline.textContent = movie.tagline;
    copy.append(tagline);
  }

  if (movie.genres.length) {
    const row = document.createElement("div");
    row.className = "detail-genres";
    for (const genre of movie.genres) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = genre;
      button.addEventListener("click", () => {
        state.genre = genre;
        state.shown = PAGE_SIZE;
        closeDetail();
        writeUrl();
        render();
      });
      row.append(button);
    }
    body.append(row);
  }

  const facts = document.createElement("div");
  facts.className = "facts";
  const factItems = [
    ["Rating", movie.voteCount ? `${ratingLabel(movie)} · ${movie.voteCount.toLocaleString()} votes` : ratingLabel(movie)],
    ["Metascore", movie.metascore != null ? String(movie.metascore) : ""],
    ["Runtime", movie.runtime ? runtimeLabel(movie.runtime) : ""],
    ["Certificate", movie.certificate || ""],
    ["Language", movie.language ? languageLabel(movie.language) : ""],
    ["Budget", movie.budget ? money(movie.budget) : ""],
    ["Box office", movie.revenue ? money(movie.revenue) : ""],
  ];
  for (const [label, value] of factItems) {
    if (value) facts.append(fact(label, value));
  }
  if (facts.childElementCount) body.append(facts);

  const overview = document.createElement("p");
  overview.className = "prose";
  overview.textContent = movie.overview || "No synopsis in the archive.";
  body.append(overview);

  body.append(personBlock("Director", movie.director, true));
  if (movie.cast) body.append(textBlock("Cast", movie.cast));
  if (movie.companies.length) body.append(textBlock("Studios", movie.companies.join(", ")));

  const links = document.createElement("div");
  links.className = "block link-row";
  if (movie.imdb) {
    const link = document.createElement("a");
    link.className = "home-link";
    link.href = `https://www.imdb.com/title/${movie.imdb}/`;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "IMDb";
    links.append(link);
  }
  if (movie.homepage && /^https?:\/\//i.test(movie.homepage)) {
    const link = document.createElement("a");
    link.className = "home-link";
    link.href = movie.homepage;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Official site";
    links.append(link);
  }
  if (links.childElementCount) body.append(links);
}

function textBlock(label, text) {
  const block = document.createElement("div");
  block.className = "block";
  const heading = document.createElement("h3");
  heading.textContent = label;
  const copy = document.createElement("p");
  copy.textContent = text;
  block.append(heading, copy);
  return block;
}

function personBlock(label, name, searchable) {
  const block = document.createElement("div");
  block.className = "block";
  const heading = document.createElement("h3");
  heading.textContent = label;
  const copy = document.createElement("p");
  if (name && searchable) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "linkish";
    button.textContent = name;
    button.addEventListener("click", () => {
      state.query = name;
      state.sort = "relevance";
      els.q.value = name;
      els.sort.value = "relevance";
      state.shown = PAGE_SIZE;
      closeDetail();
      writeUrl();
      render();
    });
    copy.append(button);
  } else {
    copy.textContent = name || "Unknown";
  }
  block.append(heading, copy);
  return block;
}

function openDetail(movie) {
  state.activeId = movie.id;
  fillDetail(movie);
  if (!els.detail.open) els.detail.showModal();
}

function closeDetail() {
  state.activeId = null;
  if (els.detail.open) els.detail.close();
}

function onSearchInput() {
  state.query = els.q.value.trim();
  if (state.query && (state.sort === "popular" || !state.sort)) {
    state.sort = "relevance";
    els.sort.value = "relevance";
  }
  if (!state.query && state.sort === "relevance") {
    state.sort = "popular";
    els.sort.value = "popular";
  }
  state.shown = PAGE_SIZE;
  writeUrl();
  render();
}

els.q.addEventListener("input", onSearchInput);
document.querySelector("#search-form").addEventListener("submit", (event) => event.preventDefault());
els.sort.addEventListener("change", () => {
  state.sort = els.sort.value;
  state.shown = PAGE_SIZE;
  writeUrl();
  render();
});
els.decade.addEventListener("change", () => {
  state.decade = els.decade.value;
  state.shown = PAGE_SIZE;
  writeUrl();
  render();
});
els.rating.addEventListener("change", () => {
  state.minRating = Number(els.rating.value);
  state.shown = PAGE_SIZE;
  writeUrl();
  render();
});
els.clear.addEventListener("click", () => {
  state.query = "";
  state.genre = "";
  state.decade = "";
  state.minRating = 0;
  state.sort = "popular";
  state.shown = PAGE_SIZE;
  els.q.value = "";
  els.sort.value = "popular";
  els.decade.value = "";
  els.rating.value = "0";
  writeUrl();
  render();
  els.q.focus();
});
els.more.addEventListener("click", () => {
  state.shown += PAGE_SIZE;
  render();
});
els.close.addEventListener("click", closeDetail);
els.detail.addEventListener("click", (event) => {
  const rect = els.detail.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;
  if (!inside) closeDetail();
});
els.detail.addEventListener("close", () => {
  state.activeId = null;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== els.q) {
    event.preventDefault();
    els.q.focus();
    els.q.select();
  }
});

readUrl();

fetch("data/movies.json")
  .then((response) => {
    if (!response.ok) throw new Error(`Could not load movies (${response.status})`);
    return response.json();
  })
  .then((movies) => {
    state.movies = prepare(movies);
    fillDecades();
    paintGenreChips();
    render();
  })
  .catch((error) => {
    els.status.textContent = error.message;
  });
