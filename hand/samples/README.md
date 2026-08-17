# Samples

Generated output, committed so the pipeline's behaviour is visible without
running anything.

- `7hand-sample.pdf` — two A4 pages from the **demo style**, which is a serif
  typeface pushed through the real pipeline. Exercises layout, drift and PDF
  export. Not handwriting.

- `7hand-learned-from-a-page.pdf` — the whole point. A simulated photograph of
  eight handwritten lines was analysed (deskew, line/word/letter segmentation),
  aligned against a transcript, and turned into a style of 177 samples across
  26 characters. This PDF is **different text**, never present on the source
  page, written in that learned hand. 433 letters from 143 embedded shapes,
  78 KB.

  Note what it could NOT render: `E 4 : R W A . , T`. The source page was
  entirely lowercase, so the learned style has no capitals and no punctuation.
  That is the practical catch of learning from a page — whatever the page does
  not contain, the style does not have.

Regenerate: `tools/learn.html` to learn a hand, then `app.html` to write with it.
