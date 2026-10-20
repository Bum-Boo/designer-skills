# Runtime and scope

The builder and inspector were originally exercised with Blender 5.2.1 and 5.2.2. Earlier private execution included a 1280 × 1024 render and a fresh-process OptiX render. The public-package verification is recorded separately in `docs/validation.md`; these statements are not a promise of compatibility with every Blender release or backend.

The included example is a synthetic 160 × 238 × 10 mm device. Tests cover 17 invalid specifications, required scene structure, supported dimensions, text bounds and fresh-process inspection. A valid 180 mm width variation was also exercised in the original workflow. Recheck the actual image whenever dimensions, camera, labels or materials change.

## Limits

- The template is a starting scene, not a general image-to-3D model.
- Labels use printable ASCII. Auto-fitting width does not guarantee readable text.
- The inspector checks FILE image dependencies, basic framing and scene structure. Linked libraries, caches, movie clips and image sequences need separate checks.
- The inspector records render size; compare it with the requested size, including render percentage.
- CUDA/OptiX availability is checked at runtime. CPU remains the portable baseline.
- No AI model cleanup, toon setup or animation playback is bundled or claimed as tested here.
- Material/World `use_nodes` produced deprecation notices in the tested release. Check a small build/save/reopen/render cycle before upgrading.

The scripts use Blender's own Python modules. Run them with Blender, not an ordinary Python interpreter. No network, hosted render service or global preference change is needed.
