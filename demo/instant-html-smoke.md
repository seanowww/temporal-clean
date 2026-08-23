# Instant HTML smoke test

This small change exists to verify the public Temporal reviewer flow:

1. Opening the pull request starts the Temporal workflow.
2. The workflow generates a self-contained timeline.
3. The Pages publisher stores the timeline as `pr-<number>.html`.
4. The durable bot comment opens that HTML directly.
