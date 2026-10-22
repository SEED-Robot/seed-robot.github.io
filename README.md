# SEED · Gene–Body Explorer

An interactive, measured-data viewer for an evolved SEED robot.

**Live:** https://seed-robot.github.io/

Select a gene in the regulatory graph, or choose one of six measured groups. Rotate and zoom the original voxel geometry, inspect arbitrary cross-sections, and explore material and joint fields.

## Controls

- **Orbit:** drag the canvas. **Zoom:** scroll or pinch. **Pan:** right-drag.
- **Select a gene:** click a graph node or use the intervention selector.
- **Section:** choose Cutaway, Cross-section only, or Thin slab. Choose X, Y, Z, or a custom plane normal. Adjust depth using the slider, the on-canvas handle, or Shift-drag.
- **Display:** material dependence, fixed WT body regions, WT gene products, Hm, Hj, or measured KO−WT field differences.
- **Body:** WT assembled body, WT raw material, or the measured KO raw material. Display options control opacity, hardware, and voxel edges.

## What the data mean

WT is the unedited reference; KO switches off production for the selected gene(s). The graph contains 22 genes and 21 signed directed relationships. Selecting a node displays its actual single-gene intervention. The six group options are measured combinations, not six established independent functional modules. Arbitrary combinations are not synthesized.

The example is the flat-terrain, 50-generation champion `g0048_c017`, from the frozen SEED 2.3.2 experiment. The WT contains 10,452 raw material voxels and 9,665 assembled physical voxels. Voxel pitch is 12 mm; coordinates remain in the developmental reference frame. Assembled-body rendering includes the original static joint hardware. KO raw material is not a newly simulated working robot; assembly failures remain visible in the status.

Fields are displayed in a common 32 × 61 × 56 crop of the original 81³ grid, covering all saved WT/edited material plus a 36 mm margin. WT gene products were saved only inside WT raw material. Missing product samples outside that material are unknown, not zero. For a group, the product view shows the sum of its members' WT products; this is not learned attention or a causal attribution map. Difference fields are KO minus WT. Field values are stored as Float32 for display only.

Material dependence is measured loss relative to WT. In the all-groups view, distinct colors denote loss exclusive to one tested group, pale blue denotes loss shared by several groups, and gray denotes no measured loss. A response does not by itself isolate a direct regulatory mechanism, prove cooperation, establish generality, or demonstrate a locomotion benefit.

## Implementation and deployment

Static HTML, CSS, JavaScript and compressed data modules; no third-party runtime, analytics, remote fonts, backend, or build step. WebGL 2 and `DecompressionStream` are required. Data load on demand; at most four intervention cases are cached alongside the base dataset. The original voxel boundaries are retained without spatial interpolation.

GitHub Pages serves the root of the `main` branch. `.nojekyll` disables Jekyll processing. No experimental code, local filesystem paths, credentials, or full experiment archives are included.
