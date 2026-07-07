# Pathlight

A physically-based Monte Carlo path tracer in TypeScript with **zero runtime
dependencies**, deterministic byte-identical PNG output, and a test suite that
validates the rendering *physics* (furnace test, sampling distributions,
fresnel), not just the code.

Full README with gallery, physics notes, architecture map, limitations and
roadmap lands with the rendered scenes. Until then:

```bash
npm ci
npm test          # typecheck + build + 100+ physics-validated tests
npm run render:all
```

License: MIT (c) 2026 GreenPandaTech.
