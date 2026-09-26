# Card search API

Start the service locally:

```powershell
npm run worker:build
npm run worker:start
```

The API reads `DATABASE_URL` from `.env` and listens on port `8080` by default.

## Search cards

```http
GET /api/cards?q=climate&page=1&limit=25
```

Supported parameters:

| Parameter | Meaning |
| --- | --- |
| `q` | PostgreSQL web-style full text query across tag, citation, and body |
| `scope` | Restrict matching to `all`, `tag`, `cite`, or `body` |
| `page` | Page number, starting at 1 |
| `limit` | Results per page, from 1 through 100 |
| `yearMin` / `yearMax` | Inclusive evidence year range |
| `author` | Case-insensitive partial author match |
| `collection` | Exact collection match, case-insensitive |
| `school` | Exact school match, case-insensitive |
| `teamName` | Exact team folder match, case-insensitive |
| `sort` | `relevance`, `year-new`, `year-old`, or `newest` |

Tag-scoped queries containing the standalone words `no` or `not` use an
additional stop-word-preserving tag index. For example,
`q=no impact to invasion&scope=tag` requires those words to occur in the tag,
instead of silently dropping `no` as an English stop word. Other queries keep
using the standard English full-text index.

The response contains `items`, `page`, `limit`, `total`, and `totalPages`. Each item includes its card text, ranking score, source count, and one source with the formatted paragraph XML needed by the preview.

## Card detail

```http
GET /api/cards/{cardId}
```

Returns the card and every source occurrence. Each source includes document metadata, paragraph indexes, and formatted paragraph XML.

## Filter values

```http
GET /api/filters
```

Returns the available collections, schools, and team names.

## Download a card as DOCX

```http
GET /api/cards/{cardId}/download?sourceId={sourceId}
```

The API downloads the original archive from R2, extracts the source DOCX, rebuilds it with the selected card paragraphs, and returns a Word document. `sourceId` selects the exact source occurrence shown in the preview and may be omitted to use the first source.

## Health check

```http
GET /health
```

Set `CORS_ORIGIN` to the deployed web application's origin. The default is `http://localhost:5173`.
