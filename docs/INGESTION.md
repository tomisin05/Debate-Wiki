# Tournament ingestion

## Accepted upload formats

- A single `.docx` file.
- A `.zip` containing Word documents at any folder depth.

The weekly NDT/CEDA archive convention is interpreted as:

```text
collection/school/teamName/document.docx
```

For example:

```text
ndtceda26/Binghamton/Novices/Binghamton-Novices-Aff-GMU-All-Rounds.docx
```

becomes:

```text
collection = ndtceda26
school     = Binghamton
teamName   = Novices
```

Each school can contain multiple team folders. The complete source path is retained.
Files beginning with `~$`, macOS metadata,
folder entries, and non-DOCX files are ignored.

## Card identity

Exact duplicate identity is based on normalized citation and body text. The tag
is excluded because teams frequently write different tags for the same evidence.
The production worker will store a SHA-256 digest of this normalized value in
`cards.content_hash`. Every occurrence remains represented in `card_sources`.

## Safety limits

The browser importer currently accepts at most 5,000 DOCX files and 2 GB of
expanded document data per operation. Production ingestion must enforce the same
limits before extracting an archive on the worker.
