/**
 * Deterministic single-scattering energy (directional albedo) tables for the
 * GGX microfacet lobes, for Kulla-Conty style multiple-scattering energy
 * compensation ("Revisiting Physically Based Shading at Imageworks", 2017).
 *
 * A single-scattering microfacet BRDF only models light that bounces off one
 * microfacet: paths that would strike a second facet are simply discarded by
 * the masking-shadowing term, so the surface darkens as roughness grows (this
 * codebase measures a 0.32 white-furnace mean at roughness 1 without
 * compensation). The fix needs E(mu) - how much energy the single-scattering
 * lobe actually returns for light arriving at cos(theta) = mu - and its
 * cosine-weighted average E_avg. Everything downstream (the reciprocal
 * multiple-scattering lobe for conductors, the energy-normalisation for rough
 * dielectrics) is derived from these tables.
 *
 * The tables are computed here at material construction, by deterministic
 * midpoint quadrature - pure math, no RNG, no baked data files - so they can
 * never drift from the BRDF code they compensate, and worker threads
 * recompute bit-identical values. The integrand is exactly the throughput
 * weight the sampler produces: half-vectors swept through the same
 * NDF-inverse mapping as `sampleGGXNormal`, weight G1(wo) G1(wi) (wo.h) /
 * ((n.wo)(n.h)) - i.e. f * cos / pdf - with the same rejection rules as
 * `scatter`, so E(mu) is the expected attenuation of a scatter event by
 * construction. The tests cross-check the quadrature against independent
 * Monte Carlo estimates.
 *
 * Grids: 32 mu midpoints (linear interpolation), 32 azimuth midpoints over a
 * half turn (the integrand is symmetric in phi), and 128 midpoints in
 * t = sqrt(1 - u2). The t-substitution absorbs the 1/(n.h) integrable
 * singularity that rough-dielectric transmission has at grazing half-vectors,
 * where plain u2 quadrature converges poorly.
 */
import { neg, refract, vec3, type Vec3 } from './vec3.js';
import { fresnelDielectric, smithG1 } from './microfacet.js';

const N_MU = 32;
const N_PHI = 32;
const N_T = 128;

/** Single-scatter directional albedo table with its cosine-weighted average. */
export interface EnergyTable {
  /** E(mu): expected scatter throughput for light arriving at cos(theta)=mu. */
  directional(mu: number): number;
  /** E_avg = 2 * integral of E(mu) mu dmu over [0, 1]. */
  readonly average: number;
}

/** Linear interpolation over N_MU midpoint samples of E(mu), clamped at the ends. */
class MidpointTable implements EnergyTable {
  readonly average: number;

  constructor(private readonly values: Float64Array) {
    // Midpoint rule for E_avg = 2 * int E(mu) mu dmu on the same grid.
    let sum = 0;
    for (let k = 0; k < N_MU; k++) {
      const mu = (k + 0.5) / N_MU;
      sum += (values[k] ?? 0) * mu;
    }
    this.average = (2 * sum) / N_MU;
  }

  directional(mu: number): number {
    const x = mu * N_MU - 0.5;
    if (x <= 0) return this.values[0] ?? 0;
    if (x >= N_MU - 1) return this.values[N_MU - 1] ?? 0;
    const i = Math.floor(x);
    const f = x - i;
    return (this.values[i] ?? 0) * (1 - f) + (this.values[i + 1] ?? 0) * f;
  }
}

/** Half-vector for quadrature node (phi, t): the sampleGGXNormal map with u2 = 1 - t^2. */
function halfVector(phi: number, t: number, alpha: number): Vec3 {
  const u2 = 1 - t * t;
  const cos2 = (1 - u2) / (1 + (alpha * alpha - 1) * u2);
  const cosTheta = Math.sqrt(cos2);
  const sinTheta = Math.sqrt(Math.max(0, 1 - cos2));
  return vec3(Math.cos(phi) * sinTheta, Math.sin(phi) * sinTheta, cosTheta);
}

const N = vec3(0, 0, 1);

/**
 * E(mu) for one incident direction: the double integral of the sampler's
 * throughput weight over (u1, u2), evaluated by midpoint quadrature. The
 * `lobes` callback returns the weight for one half-vector (both lobes summed
 * for a dielectric), already including its validity rejections.
 */
function directionalAlbedo(
  mu: number,
  alpha: number,
  lobes: (wo: Vec3, h: Vec3, woh: number, nh: number) => number,
): number {
  const wo = vec3(Math.sqrt(Math.max(0, 1 - mu * mu)), 0, mu);
  let sum = 0;
  for (let j = 0; j < N_PHI; j++) {
    const phi = (Math.PI * (j + 0.5)) / N_PHI; // half turn, doubled by symmetry
    for (let k = 0; k < N_T; k++) {
      const t = (k + 0.5) / N_T;
      const h = halfVector(phi, t, alpha);
      const woh = wo.x * h.x + wo.z * h.z; // wo.y = 0
      if (woh <= 0 || h.z <= 0) continue;
      // du2 = 2t dt for the substitution u2 = 1 - t^2.
      sum += lobes(wo, h, woh, h.z) * 2 * t;
    }
  }
  return sum / (N_PHI * N_T);
}

/** Walter's throughput weight for NDF half-vector sampling: f*cos/pdf = G1 G1 (wo.h)/((n.wo)(n.h)). */
function sampleWeight(wo: Vec3, wi: Vec3, woh: number, nh: number, alpha: number): number {
  return (smithG1(N, wo, alpha) * smithG1(N, wi, alpha) * woh) / (wo.z * nh);
}

function buildConductorTable(alpha: number): MidpointTable {
  const values = new Float64Array(N_MU);
  for (let k = 0; k < N_MU; k++) {
    const mu = (k + 0.5) / N_MU;
    values[k] = directionalAlbedo(mu, alpha, (wo, h, woh, nh) => {
      // Reflect wo about h; below-horizon reflections are rejected by scatter.
      const wi = vec3(2 * woh * h.x - wo.x, 2 * woh * h.y - wo.y, 2 * woh * h.z - wo.z);
      if (wi.z <= 0) return 0;
      return sampleWeight(wo, wi, woh, nh, alpha);
    });
  }
  return new MidpointTable(values);
}

function buildDielectricTable(alpha: number, etaRel: number): MidpointTable {
  const values = new Float64Array(N_MU);
  for (let k = 0; k < N_MU; k++) {
    const mu = (k + 0.5) / N_MU;
    values[k] = directionalAlbedo(mu, alpha, (wo, h, woh, nh) => {
      const f = fresnelDielectric(woh, etaRel);
      let sum = 0;
      const wr = vec3(2 * woh * h.x - wo.x, 2 * woh * h.y - wo.y, 2 * woh * h.z - wo.z);
      if (wr.z > 0) sum += f * sampleWeight(wo, wr, woh, nh, alpha);
      if (f < 1) {
        // Transmission must leave through the opposite hemisphere.
        const wt = refract(neg(wo), h, etaRel);
        if (wt.z < 0) sum += (1 - f) * sampleWeight(wo, wt, woh, nh, alpha);
      }
      return sum;
    });
  }
  return new MidpointTable(values);
}

// Tables depend only on (alpha) or (alpha, etaRel), so identical materials
// share one deterministic computation per process.
const conductorCache = new Map<number, EnergyTable>();
const dielectricCache = new Map<string, EnergyTable>();

/** E(mu)/E_avg of the single-scattering GGX reflection lobe with Fresnel = 1. */
export function conductorEnergy(alpha: number): EnergyTable {
  let table = conductorCache.get(alpha);
  if (!table) {
    table = buildConductorTable(alpha);
    conductorCache.set(alpha, table);
  }
  return table;
}

/**
 * E(mu)/E_avg of the single-scattering GGX dielectric (reflection +
 * refraction with the exact Fresnel split), for light arriving on the side
 * where eta_incident/eta_transmitted = etaRel.
 */
export function dielectricEnergy(alpha: number, etaRel: number): EnergyTable {
  const key = `${alpha}:${etaRel}`;
  let table = dielectricCache.get(key);
  if (!table) {
    table = buildDielectricTable(alpha, etaRel);
    dielectricCache.set(key, table);
  }
  return table;
}
