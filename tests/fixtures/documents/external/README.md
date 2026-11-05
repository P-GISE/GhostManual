# External parser fixtures

These fixtures contain synthetic text only; no business or personal information.
`GenerateFixtures.java` deterministically creates two versions of HWP v5, DOC, PPT, text PDF and Korean/English scanned PDF using the pinned parser libraries. Expected strings: `GhostManual synthetic version 1/2`, HWP `한글 합성 문서 1/2`, OCR `한글 합성 문서` and `GhostManual version 1/2`. The PPT hidden slide sentinel must never be extracted.

`empty.doc` is Apache POI's empty synthetic test document, Apache-2.0 licensed. It is inspected by `GenerateFixtures` and rejected unless its main range is blank before adding synthetic text.
Source: https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/document/empty.doc
SHA256: `5f421a3970c70f12296073478380c0849a54c03fb2f4842392c7d3c5039bf1eb`.
Apache POI license: https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/LICENSE
The generated synthetic fixtures and generator are provided under Apache-2.0.

Run the bounded, network-disabled fixture generation/smoke procedure in `services/document-extractor/README.md`. Parsing smoke is distinct from the required namespace/cgroup security gate.
