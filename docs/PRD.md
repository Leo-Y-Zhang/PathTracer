# PathTracer — requirements

v1.2.0, recorded from the shipped code. Where the code falls short of what a
reader might assume, this document says so in the body rather than in a
footnote. Design: [TDD.md](TDD.md).

## A beautiful picture of the wrong integral

A renderer can produce a beautiful image and still be wrong. A missing cosine,
a pdf that does not match the sampler, a russian-roulette survival probability
applied without the compensating `1/p` — every one of those still yields a
plausible picture, just a picture of the wrong integral.

The usual defences are weak. Comparing against a reference image only proves
the renderer agrees with itself; comparing against a commercial renderer only
moves the question somewhere else.

So the problem is not "write a path tracer". That is a solved exercise with
good tutorials. The problem is to **write a path tracer whose correctness can
be checked by someone who does not trust you**, and who has half an hour.

## Requirements

**Must**

- Unbiased estimator. Any feature that fails a furnace test does not ship.
- Determinism: no `Math.random` anywhere in the render path, and a per-sample
  RNG seeded only from `(x, y, sampleIndex, seed)`, so a pixel's value does not
  depend on what is rendered beside it. Asserted, not assumed.
- Zero runtime dependencies.
- Scene input is declarative JSON, with errors that name the offending path:
  `scene: $.materials.gold.roughness: expected a number in [0, 1], got 4`.
- Strict TypeScript (`noUncheckedIndexedAccess`), lint and tests in CI.

**Should**

- Fast enough to be worth running — next-event estimation with MIS, a BVH, and
  a worker-thread tile renderer whose output is byte-identical to one thread.
- Physically credible materials rather than the tutorial minimum: GGX
  microfacets with multiple-scattering energy compensation, and HDR
  image-based lighting importance-sampled inside the NEE mixture.

**Won't, this time**

- Spectral rendering, participating media, denoising, bidirectional path
  tracing or MLT.
- A GUI, a live preview, or an interactive viewer.
- Publishing to npm. The package is `private: true` and the licence grants no
  reuse right.

## The tests are the product

A golden-image suite would have been easier and is the obvious thing to reach
for. It was rejected outright: image comparison proves self-consistency only,
and a biased renderer passes its own golden images forever. Determinism *is*
checked by hash here — but as a determinism claim, never as a correctness one.

What ships instead:

- [x] Every physical claim is asserted against an **analytic** ground truth. A
      furnace test — an albedo-0.5 sphere in a radiance-1 environment renders
      to mean 0.5 — is checked to 1%, and the white furnace (albedo 1, many
      bounces) must converge to 1.0 or russian roulette is biased.
      `tests/integrator.test.ts`, `tests/envnee.test.ts`.
- [x] Every sampling distribution is validated against an **independent
      estimator** of the same quantity, so a pdf and its sampler cannot be
      wrong in the same direction and quietly agree.
      `tests/envlight.test.ts` asserts the environment pdf integrates to 1 and
      that `E[1/pdf] = 4π` over its own samples; `tests/light_sampling.test.ts`
      does the same for area lights.
- [x] **Byte-identical output for identical input**, single- or
      multi-threaded, asserted by SHA-256 in `tests/determinism.test.ts` and
      `tests/cli.test.ts`. A reviewer's render of a committed scene reproduces
      the committed PNG.
- [x] **Zero runtime dependencies** (`dependencies: {}`). The PNG encoder and
      decoder, the Radiance `.hdr` codec, the RNG, the BVH and the OBJ loader
      are all in-tree. Nothing in the rendering path is code a reviewer would
      have to take on trust from npm.
- [x] Everything a reviewer needs runs from a clone: `npm ci && npm test`,
      Node ≥ 20, no downloads. Both committed assets — the HDR sky and the
      torus-knot OBJ — are *generated* by in-tree scripts
      (`npm run assets:all`).
- [x] The README gallery is reproducible from source by `npm run render:all`.
      The images are output, not artwork.

## Two readers, and no third

A reviewer evaluating the author's engineering — an admissions tutor, an
interviewer, an engineer skimming a portfolio. They want to know whether the
README's claims are true, and they will find out by running `npm test` and
reading a test file. The licence explicitly grants them that right.

And the author, as the person who has to change the integrator later without
silently breaking it.

It is not for anyone who needs to render production images. Cycles, PBRT and
Mitsuba exist, are faster by orders of magnitude, and support spectral
rendering, volumes and denoising that this does not.

## Where the line is

**Speed is not the headline.** Single machine, CPU only, in JavaScript. A GPU
renderer is thousands of times faster and that is not the point being made.
Optimisation is pursued only where it costs neither clarity nor determinism —
hence a median-split BVH rather than SAH, which is a documented choice.

**Untrusted scene files are out.** A scene JSON names files to read — `.hdr`
environments, `.obj` meshes, `.png` textures — and the parser opens them. A
scene is treated as *code the user chose to run*, not as data from a stranger.
Sandboxing it is deliberately not attempted; the honest mitigation is the
documented boundary below.

**Cross-machine byte-identical output is out.** Pixel values are identical on
any machine, since the arithmetic is IEEE double and the RNG is integer. The
*file bytes* depend on the zlib build that compresses the IDAT chunk, and the
README says so.

**Bilinear filtering of the environment map is out.** Nearest-texel sampling
keeps the sampling pdf and the returned radiance exactly consistent per texel,
which is what the quadrature test proves. Filtering would break that agreement
to make low-resolution maps look nicer. Correctness won.

## The scene file is code

No personal data of any kind. The renderer reads a scene file and writes a PNG.
It opens no network connection and has no telemetry, no analytics, no account,
and no configuration outside the scene file and the CLI flags. There is no data
to leak and no access to revoke.

The one real trust boundary is the scene file itself. `parseScene` passes
`environment.path`, `textures[].path` and mesh `path` values straight to
`readFileSync`. A malicious scene can therefore make the process attempt to
read any file the user can read. It cannot exfiltrate what it reads — the bytes
are decoded as PNG, OBJ or HDR, and a mismatch throws — and it cannot write
anywhere except the `--out` path. Rendering someone else's scene file is
equivalent to running their script.

Worst case if that judgement is wrong: a crafted scene reads a path it should
not, or allocates a huge buffer and exhausts memory, since `render.width`,
`height` and `spp` from the scene are not bounded. For a local offline tool run
on scenes the user wrote, that is accepted rather than fixed.

Worst case if the *physics* is wrong is different in kind: a reviewer is misled
about the author's competence. That is precisely why the validation suite
asserts analytic values instead of snapshots. A snapshot test would have
happily frozen a wrong image.

## Rejected

| Considered | Rejected because |
|---|---|
| A dependency for PNG, `.hdr` or OBJ parsing | The claim being made is about understanding the whole path from the rendering equation to the file bytes. Importing `pngjs` would delete the most instructive code in the repo and add supply-chain surface to a portfolio piece. The cost is ~500 lines of codec that the tests carry. |
| SAH BVH | Median split is ~40 lines and its correctness is proven against brute force. SAH buys traversal speed for scenes an order of magnitude larger than the targets here. Listed on the roadmap, honestly, rather than half-built. |
| Rendering to a live preview window | Needs a GUI dependency and a non-deterministic frame loop, and would compete with the determinism guarantee for no reviewer benefit. |
| Skipping multiple-scattering compensation ("looks fine") | It does look fine — and reads 0.32 instead of 1.0 in an albedo-1 furnace at roughness 1. Measured, not assumed. Fixing it was the whole of v1.2.0. |
| A reciprocal multiple-scattering lobe for the rough dielectric | Needs separate interior/exterior lobes. The Imageworks `1/E(mu_o)` scaling closes the furnace exactly and breaks reciprocity, which costs nothing in a camera-only unidirectional tracer. Documented as a limitation rather than hidden. |
| Making the rough dielectric non-specular so NEE can sample it | Needs a transmission eval/pdf pair with correct half-vector Jacobians. Declaring it specular costs variance under small lights, never bias. On the roadmap. |

## Two live design questions

Neither blocks anything; v1.2.0 shipped. Both are on the README roadmap.

A transmission eval/pdf pair for the rough dielectric would remove the
fireflies that high-IOR frosted glass produces at low sample counts. The
`GGXDielectric` docblock has the measurement: at roughness 1 and ior 2.4 it
reads 0.94 and 0.93 against a furnace target of 1.0 — variance, not bias.

A low-discrepancy sampler, Sobol or Halton, would cut sample counts. It must
not break the `(x, y, sampleIndex, seed)` seeding contract that the determinism
guarantee rests on.
