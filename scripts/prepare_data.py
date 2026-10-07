#!/usr/bin/env python3
"""Build the search catalog from the TMDB spreadsheet and the IMDb spreadsheet."""

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CSV = Path.home() / "Downloads" / "movie_dataset.csv"
IMDB_CSV = Path.home() / "Downloads" / "imdb_data.csv"
OUT = ROOT / "data" / "movies.json"

GENRE_ALIASES = {
    "sci-fi": "Science Fiction",
    "science fiction": "Science Fiction",
}

GENRES = [
    "Science Fiction",
    "TV Movie",
    "Action",
    "Adventure",
    "Animation",
    "Comedy",
    "Crime",
    "Documentary",
    "Drama",
    "Family",
    "Fantasy",
    "History",
    "Horror",
    "Music",
    "Mystery",
    "Romance",
    "Thriller",
    "War",
    "Western",
    "Foreign",
]
GENRES_SORTED = sorted(GENRES, key=len, reverse=True)


def parse_genres(raw: str) -> tuple[list[str], str]:
    text = (raw or "").strip()
    found: list[str] = []
    i = 0
    while i < len(text):
        if text[i] == " ":
            i += 1
            continue
        matched = None
        for genre in GENRES_SORTED:
            end = i + len(genre)
            if text[i:end].lower() == genre.lower() and (end == len(text) or text[end] == " "):
                matched = genre
                break
        if matched:
            found.append(matched)
            i += len(matched)
            continue
        nxt = text.find(" ", i)
        if nxt == -1:
            return found, text[i:]
        i = nxt + 1
    return found, ""


def names_from_json(raw: str) -> list[str]:
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    names = []
    for item in data:
        if isinstance(item, dict) and item.get("name"):
            names.append(str(item["name"]))
    return names


def number(raw: str):
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if value.is_integer():
        return int(value)
    return round(value, 3)


def positive(raw: str):
    value = number(raw)
    if value in (None, 0):
        return None
    return value


def year_of(raw: str):
    raw = (raw or "").strip()
    if len(raw) >= 4 and raw[:4].isdigit():
        return int(raw[:4])
    return None


def clean(raw: str) -> str:
    return " ".join((raw or "").split())


def norm_title(title: str) -> str:
    text = clean(title).lower().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def imdb_year(raw: str):
    found = re.findall(r"(?:19|20)\d{2}", raw or "")
    if not found:
        return None
    return int(found[0])


def imdb_runtime(raw: str):
    match = re.search(r"(\d+)", raw or "")
    if not match:
        return None
    minutes = int(match.group(1))
    return minutes or None


def imdb_votes(raw: str):
    digits = re.sub(r"[^\d]", "", raw or "")
    if not digits:
        return 0
    return int(digits)


def imdb_gross(raw: str):
    match = re.search(r"([0-9]*\.?[0-9]+)\s*([MBK])?", (raw or "").replace(",", ""), re.I)
    if not match:
        return None
    value = float(match.group(1))
    unit = (match.group(2) or "").upper()
    multiplier = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}[unit]
    amount = int(value * multiplier)
    return amount or None


def imdb_metascore(raw: str):
    match = re.search(r"\d+", raw or "")
    if not match:
        return None
    score = int(match.group(0))
    if score > 100:
        return None
    return score


def poster_url(raw: str) -> str:
    url = clean(raw)
    if "/images/M/" not in url:
        return ""
    return re.sub(r"\._V1_.*(\.[A-Za-z]+)$", r"._V1_SX300\1", url)


def imdb_id(raw: str) -> str:
    match = re.search(r"(tt\d+)", raw or "")
    return match.group(1) if match else ""


def canonical_genre(name: str) -> str:
    cleaned = clean(name)
    if not cleaned:
        return ""
    return GENRE_ALIASES.get(cleaned.lower(), cleaned)


def imdb_genres(raw: str) -> list[str]:
    found = []
    for part in (raw or "").split(","):
        genre = canonical_genre(part)
        if genre and genre not in found:
            found.append(genre)
    return found


def load_tmdb(source: Path) -> list[dict]:
    movies = []
    with source.open(newline="", encoding="utf-8", errors="replace") as handle:
        for row in csv.DictReader(handle):
            title = clean(row.get("title") or row.get("original_title") or "")
            if not title:
                continue
            genres, _leftover = parse_genres(row.get("genres") or "")
            release_date = clean(row.get("release_date") or "")
            movies.append(
                {
                    "id": number(row.get("id") or "") or len(movies) + 1,
                    "title": title,
                    "originalTitle": clean(row.get("original_title") or ""),
                    "tagline": clean(row.get("tagline") or ""),
                    "overview": clean(row.get("overview") or ""),
                    "genres": [canonical_genre(genre) for genre in genres],
                    "director": clean(row.get("director") or ""),
                    "cast": clean(row.get("cast") or ""),
                    "releaseDate": release_date,
                    "year": year_of(release_date),
                    "runtime": positive(row.get("runtime") or ""),
                    "voteAverage": number(row.get("vote_average") or ""),
                    "voteCount": number(row.get("vote_count") or "") or 0,
                    "budget": positive(row.get("budget") or ""),
                    "revenue": positive(row.get("revenue") or ""),
                    "language": clean(row.get("original_language") or ""),
                    "status": clean(row.get("status") or ""),
                    "companies": names_from_json(row.get("production_companies") or ""),
                    "homepage": clean(row.get("homepage") or ""),
                }
            )
    return movies


def load_imdb(source: Path) -> list[dict]:
    best: dict[tuple, dict] = {}
    with source.open(newline="", encoding="utf-8", errors="replace") as handle:
        for row in csv.DictReader(handle):
            title = clean(row.get("Title") or "")
            if not title:
                continue
            stars = [
                clean(row.get(key) or "")
                for key in ("Content4", "Content6", "Content8", "Content10")
            ]
            stars = [name for name in stars if name and name.lower() != "director"]
            film = {
                "imdb": imdb_id(row.get("Title_URL") or ""),
                "title": title,
                "overview": clean(row.get("Synopsis") or ""),
                "genres": imdb_genres(row.get("genre") or ""),
                "director": clean(row.get("Director") or ""),
                "cast": ", ".join(stars),
                "year": imdb_year(row.get("Year") or ""),
                "runtime": imdb_runtime(row.get("Time") or ""),
                "voteAverage": number(row.get("Rating") or ""),
                "voteCount": imdb_votes(row.get("Votes") or ""),
                "revenue": imdb_gross(row.get("Gross") or ""),
                "poster": poster_url(row.get("Image") or ""),
                "certificate": clean(row.get("certificate") or ""),
                "metascore": imdb_metascore(row.get("Score") or ""),
            }
            key = (norm_title(title), film["year"])
            current = best.get(key)
            if current is None or film["voteCount"] > current["voteCount"]:
                best[key] = film
    return list(best.values())


def merge_genres(left: list[str], right: list[str]) -> list[str]:
    merged = []
    for genre in [*left, *right]:
        if genre and genre not in merged:
            merged.append(genre)
    return merged


def attach_imdb(movie: dict, imdb: dict) -> None:
    if imdb.get("poster"):
        movie["poster"] = imdb["poster"]
    if imdb.get("imdb"):
        movie["imdb"] = imdb["imdb"]
    if imdb.get("certificate"):
        movie["certificate"] = imdb["certificate"]
    if imdb.get("metascore") is not None:
        movie["metascore"] = imdb["metascore"]
    if imdb["voteCount"] > (movie.get("voteCount") or 0) and imdb.get("voteAverage") is not None:
        movie["voteAverage"] = imdb["voteAverage"]
        movie["voteCount"] = imdb["voteCount"]
    if not movie.get("revenue") and imdb.get("revenue"):
        movie["revenue"] = imdb["revenue"]
    if not movie.get("runtime") and imdb.get("runtime"):
        movie["runtime"] = imdb["runtime"]
    if not movie.get("director") and imdb.get("director"):
        movie["director"] = imdb["director"]
    if imdb.get("cast"):
        movie["cast"] = imdb["cast"]
    if len(imdb.get("overview") or "") > len(movie.get("overview") or ""):
        movie["overview"] = imdb["overview"]
    movie["genres"] = merge_genres(movie.get("genres") or [], imdb.get("genres") or [])


def imdb_as_movie(imdb: dict) -> dict:
    film = {
        "id": imdb["imdb"] or f"imdb-{norm_title(imdb['title'])}-{imdb['year'] or 'na'}",
        "title": imdb["title"],
        "overview": imdb.get("overview") or "",
        "genres": imdb.get("genres") or [],
        "director": imdb.get("director") or "",
        "cast": imdb.get("cast") or "",
        "year": imdb.get("year"),
        "runtime": imdb.get("runtime"),
        "voteAverage": imdb.get("voteAverage"),
        "voteCount": imdb.get("voteCount") or 0,
        "revenue": imdb.get("revenue"),
        "poster": imdb.get("poster") or "",
        "imdb": imdb.get("imdb") or "",
        "certificate": imdb.get("certificate") or "",
        "metascore": imdb.get("metascore"),
    }
    return film


def compact(movie: dict) -> dict:
    kept = {}
    for key, value in movie.items():
        if value is None or value == "" or value == []:
            continue
        if key == "voteCount" and value == 0:
            continue
        if key == "originalTitle" and norm_title(value) == norm_title(movie.get("title") or ""):
            continue
        kept[key] = value
    return kept


def main() -> int:
    tmdb_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CSV
    imdb_path = Path(sys.argv[2]) if len(sys.argv) > 2 else IMDB_CSV
    if not tmdb_path.exists():
        print(f"Movie CSV not found: {tmdb_path}", file=sys.stderr)
        return 1
    if not imdb_path.exists():
        print(f"IMDb CSV not found: {imdb_path}", file=sys.stderr)
        return 1

    tmdb = load_tmdb(tmdb_path)
    imdb_rows = load_imdb(imdb_path)
    buckets: dict[tuple, list[dict]] = defaultdict(list)
    for movie in tmdb:
        buckets[(norm_title(movie["title"]), movie.get("year"))].append(movie)

    matched = 0
    for imdb in imdb_rows:
        key = (norm_title(imdb["title"]), imdb.get("year"))
        bucket = buckets.get(key)
        if bucket:
            attach_imdb(bucket.pop(0), imdb)
            matched += 1
            continue
        tmdb.append(imdb_as_movie(imdb))

    movies = [compact(movie) for movie in tmdb]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(movies, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    posters = sum(1 for movie in movies if movie.get("poster"))
    print(f"Wrote {len(movies)} films to {OUT} ({OUT.stat().st_size / 1_000_000:.1f} MB)")
    print(f"IMDb rows after dedupe: {len(imdb_rows)}; matched onto existing films: {matched}; with posters: {posters}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
