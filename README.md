# SEED · Gene–Body Explorer

An interactive, measured-data viewer for an evolved SEED robot.

**Live:** https://seed-robot.github.io/

Select one or several genes in the regulatory graph, or choose a measured group or pair. Rotate and zoom the original voxel geometry, inspect arbitrary cross-sections, and explore material and joint fields.

## Controls

- **Orbit:** drag the canvas. **Zoom:** scroll or pinch. **Pan:** right-drag.
- **Select a gene:** click a graph node or use the intervention selector.
- **Select several genes:** enable **Multi-select**, then click nodes to add or remove them. Shift-click also toggles membership. **Clear** starts a new selection. Bold blue edges join selected nodes.
- **Compare interaction:** select **Non-additive response** to compare a measured joint KO with the sum of its single-gene KO changes. Red means more material than that expectation; blue means less. An unmeasured combination is explicitly labeled and no joint response is inferred.
- **Section:** choose Cutaway, Cross-section only, or Thin slab. Choose X, Y, Z, or a custom plane normal. Adjust depth using the slider, the on-canvas handle, or Shift-drag.
- **Display:** material dependence, non-additive response, fixed WT body regions, WT gene products, Hm, Hj, or measured KO−WT field differences.
- **Body:** WT assembled body, WT raw material, or the measured KO raw material. Display options control opacity, hardware, and voxel edges.

## What the data mean

WT is the unedited reference; KO switches off production for the selected gene(s). The graph contains 22 genes and 21 signed directed relationships. Selecting one node displays its actual single-gene intervention. Multi-selection matches an existing intervention when available: 22 single genes and 12 measured combinations (the original six groups plus six constituent pairs). The six group options are not six established independent functional modules. For an unmeasured combination, WT products and graph relationships can still be inspected, but joint KO material and difference responses are unavailable. Arbitrary combined responses are not synthesized from single KOs.

The example is the flat-terrain, 50-generation champion `g0048_c017`, from the frozen SEED 2.3.2 experiment. The WT contains 10,452 raw material voxels and 9,665 assembled physical voxels. Voxel pitch is 12 mm; coordinates remain in the developmental reference frame. Assembled-body rendering includes the original static joint hardware. KO raw material is not a newly simulated working robot; assembly failures remain visible in the status.

Fields are displayed in a common 32 × 61 × 56 crop of the original 81³ grid, covering all saved WT/edited material plus a 36 mm margin. WT gene products were saved only inside WT raw material. Missing product samples outside that material are unknown, not zero. For a group, the product view shows the sum of its members' WT products; this is not learned attention or a causal attribution map. Difference fields are KO minus WT. Field values are stored as Float32 for display only.

Material dependence is measured loss relative to WT. In the all-groups view, distinct colors denote loss exclusive to one tested group, pale blue denotes loss shared by several groups, and gray denotes no measured loss. A response does not by itself isolate a direct regulatory mechanism, prove cooperation, establish generality, or demonstrate a locomotion benefit.

## Implementation and deployment

Static HTML, CSS, JavaScript and compressed data modules; no third-party runtime, analytics, remote fonts, backend, or build step. WebGL 2 and `DecompressionStream` are required. Data load on demand; at most four intervention cases are cached alongside the base dataset. The original voxel boundaries are retained without spatial interpolation.

GitHub Pages serves the root of the `main` branch. `.nojekyll` disables Jekyll processing. No experimental code, local filesystem paths, credentials, or full experiment archives are included.

## Reading the non-additive layer

For a selected set S, each voxel displays

`I = M_KO(S) − M_WT − sum_i [M_KO(i) − M_WT]`.

Each M is the measured binary material occupancy at the same original voxel. White means zero contrast. Blue means less material than the additive expectation; red means more. The color sign is not a measure of good or bad performance. For two genes this is the standard four-state material contrast. For three genes it includes pairwise and higher-order effects; it is **not** a pure third-order contrast. Binary bounds, shared fields, growth reachability and readout thresholds can all contribute. It does not by itself identify a direct regulatory edge or prove a biological mechanism.

Example: select **N16a + g001** (G1), then choose **Non-additive response**. The saved states give 276 positive and 309 negative voxels: 585 locations are non-additive, although the signed whole-grid sum is only −33. The viewer computes this from actual stored joint and single KOs. It performs no new developmental simulation.

Hm and Hj show the original WT fields and do not change when selecting genes. ΔHm and ΔHj show the actual selected KO minus WT. A sum of selected WT gene products indicates their spatial expression, not their interaction.

Shareable example: [G1 non-additive cutaway](https://seed-robot.github.io/?genes=N16a,g001&layer=interaction&cut=cut). The optional `genes`, `layer`, `cut`, and `body` URL parameters accept only the known gene aliases and supported display values.

## Section context

When a section is active, **Outside section** offers **Faint gray** or **Hidden**. Faint gray is the default, with independent **Context opacity** from 2–25% (default 8%). Cutaway retains the excluded half as context; Thin slab shows material outside the slab as context; Cross-section only shows the full reference body faintly around the section. Full body is unchanged.

The gray shape is drawn before the colored geometry and section without depth writes, so it cannot hide the section or tint its field values. Joint hardware follows the same rule when enabled. This is a display-only reference using the currently selected body geometry, not additional material or a regenerated robot. `context=ghost|hidden` and `contextOpacity=2..25` can be included in a shared URL.

Voxel surfaces read the owning voxel by sampling 0.12 mm inside the surface (1% of the 12 mm cell width). This avoids reading a neighboring cell at exact face boundaries. A voxel's exposed faces therefore share its data color, with lighting affecting brightness only. Section planes still sample their actual positions. No field values, masks or geometry are changed.
