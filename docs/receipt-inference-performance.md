# Receipt inference model selection

The receipt adapter uses endpoint-listed `gpt-6.1-sol` with `low` reasoning.
The selection was compared with the previous `gpt-5.6-sol` configuration using
the actual analysis route, prompt and strict schema in isolated SQLite databases.
Private receipt inputs, outputs and timing evidence remain outside the repository.

The prompt, schema, original image bytes, PDF rasterization, output limits and
response validation are unchanged. Explicit assignment rules, signed-cent
normalization and conservative learning still run through the same backend code.
There is no automatic retry or alternate-model fallback after a provider failure.

This is a backend-only change. Deployment requires restarting the Flat backend;
no frontend rebuild, environment update or database migration is needed. Reverting
the model constant and restarting the backend restores the previous selection.
One receipt comparison is a regression check, not a general accuracy guarantee.
