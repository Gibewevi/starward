import * as THREE from 'three';

/**
 * Character light grade for Lambert materials. The laboratory's key, rim and
 * sky light are cold; on the Jedi they are read as a warm neutral, so the
 * browns of the reference stay brown. Point lights — the blade's glow — keep
 * their colour, softened, and still tint the coat blue on the sword side.
 */
const GRADE = /* glsl */`
vec3 characterGrade(vec3 light) {
  float luminance = dot(light, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luminance), light, 0.35) * vec3(1.16, 0.97, 0.78);
}
`;

export function gradeCharacterMaterial(material, { inside } = {}) {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${GRADE}\nvoid main() {`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )',
        'vec3 bladeDiffuse = reflectedLight.directDiffuse;\n#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )'))
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
	reflectedLight.directDiffuse = bladeDiffuse * 0.55 + characterGrade(reflectedLight.directDiffuse - bladeDiffuse);
	reflectedLight.indirectDiffuse = characterGrade(reflectedLight.indirectDiffuse);`);
    if (inside) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        `#include <color_fragment>\n\tif (!gl_FrontFacing) diffuseColor.rgb *= vec3(${inside.map(value => value.toFixed(3)).join(', ')});`);
    }
  };
  material.customProgramCacheKey = () => `character-grade-${inside ? 'lined' : 'plain'}`;
  return material;
}
