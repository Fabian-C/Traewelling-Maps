/**
 * WebGL2 GLSL Shaders for Transit Line Extrusion & Vehicle Beacons
 * High-precision screen-space extrusion, miter joins, anti-aliased edge feathering,
 * and zero-CPU temporal track revealing.
 */

export const ROUTE_VS = `#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 a_currPoint;
layout(location = 1) in vec2 a_prevPoint;
layout(location = 2) in vec2 a_nextPoint;
layout(location = 3) in float a_extrusionSide;
layout(location = 4) in float a_timeProgress;
layout(location = 5) in vec2 a_timeWindow;
layout(location = 6) in vec4 a_categoryColor;

uniform mat3 u_cameraMatrix;
uniform vec2 u_resolution;
uniform float u_lineWidth;
uniform float u_outlineWidth;
uniform int u_passType; // 0 = outline pass, 1 = category color pass

out vec4 v_color;
out float v_timeProgress;
out vec2 v_timeWindow;
out float v_edgeDist;

void main() {
    // 1. Project points into screen pixel space via 3x3 camera matrix
    vec3 screenCurr = u_cameraMatrix * vec3(a_currPoint, 1.0);
    vec3 screenPrev = u_cameraMatrix * vec3(a_prevPoint, 1.0);
    vec3 screenNext = u_cameraMatrix * vec3(a_nextPoint, 1.0);

    // 2. Compute screen-space tangents and normal
    vec2 dirPrev = screenCurr.xy - screenPrev.xy;
    float lenPrev = length(dirPrev);
    vec2 dirNext = screenNext.xy - screenCurr.xy;
    float lenNext = length(dirNext);

    vec2 dir;
    if (lenPrev < 0.0001 && lenNext < 0.0001) {
        dir = vec2(1.0, 0.0);
    } else if (lenPrev < 0.0001) {
        dir = normalize(dirNext);
    } else if (lenNext < 0.0001) {
        dir = normalize(dirPrev);
    } else {
        dir = normalize(normalize(dirPrev) + normalize(dirNext));
    }

    // Normal perpendicular to tangent direction
    vec2 normal = vec2(-dir.y, dir.x);

    // 3. Extrude vertex along normal based on pass type
    float halfWidth = (u_passType == 0)
        ? ((u_lineWidth * 0.5) + u_outlineWidth)
        : (u_lineWidth * 0.5);

    vec2 screenOffset = normal * (a_extrusionSide * halfWidth);
    vec2 finalScreenPos = screenCurr.xy + screenOffset;

    // 4. Map screen coordinates [0, width] x [0, height] to WebGL clip space [-1, 1]
    vec2 clipSpace = (finalScreenPos / u_resolution) * 2.0 - 1.0;
    clipSpace.y = -clipSpace.y; // Invert Y for top-left window coordinates

    gl_Position = vec4(clipSpace, 0.0, 1.0);

    v_color = a_categoryColor;
    v_timeProgress = a_timeProgress;
    v_timeWindow = a_timeWindow;
    v_edgeDist = a_extrusionSide;
}
`;

export const ROUTE_FS = `#version 300 es
precision highp float;
precision highp int;

in vec4 v_color;
in float v_timeProgress;
in vec2 v_timeWindow;
in float v_edgeDist;

uniform float u_currentTime;
uniform int u_passType; // 0 = outline, 1 = category color
uniform vec4 u_outlineColor;

out vec4 fragColor;

void main() {
    // 1. Temporal culling: discard if trip has not commenced yet
    if (v_timeWindow.x > u_currentTime) {
        discard;
    }

    // 2. Progressive track revealing during active travel
    if (u_currentTime < v_timeWindow.y) {
        float span = v_timeWindow.y - v_timeWindow.x;
        if (span > 0.0001) {
            float activeFraction = (u_currentTime - v_timeWindow.x) / span;
            if (v_timeProgress > activeFraction) {
                discard;
            }
        }
    }

    // 3. Anti-aliased edge feathering
    float edgeAlpha = 1.0 - smoothstep(0.75, 1.0, abs(v_edgeDist));

    if (u_passType == 0) {
        fragColor = vec4(u_outlineColor.rgb, u_outlineColor.a * edgeAlpha);
    } else {
        fragColor = vec4(v_color.rgb, v_color.a * edgeAlpha);
    }
}
`;

export const VEHICLE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_quadOffset; // [-1..1, -1..1]
layout(location = 1) in vec2 a_centerPos;
layout(location = 2) in vec4 a_color;
layout(location = 3) in float a_radius;
layout(location = 4) in float a_pulseFactor;

uniform mat3 u_cameraMatrix;
uniform vec2 u_resolution;

out vec2 v_localCoord;
out vec4 v_color;
out float v_pulseFactor;

void main() {
    vec3 screenCenter = u_cameraMatrix * vec3(a_centerPos, 1.0);
    vec2 finalScreenPos = screenCenter.xy + (a_quadOffset * (a_radius * (1.0 + a_pulseFactor * 0.35)));

    vec2 clipSpace = (finalScreenPos / u_resolution) * 2.0 - 1.0;
    clipSpace.y = -clipSpace.y;

    gl_Position = vec4(clipSpace, 0.0, 1.0);
    v_localCoord = a_quadOffset;
    v_color = a_color;
    v_pulseFactor = a_pulseFactor;
}
`;

export const VEHICLE_FS = `#version 300 es
precision highp float;

in vec2 v_localCoord;
in vec4 v_color;
in float v_pulseFactor;

out vec4 fragColor;

void main() {
    float dist = length(v_localCoord);
    if (dist > 1.0) {
        discard;
    }

    // Inner vehicle dot with smooth outer border and pulse halo
    float coreRadius = 0.55;
    float coreAlpha = 1.0 - smoothstep(coreRadius - 0.08, coreRadius, dist);
    float ringAlpha = (1.0 - smoothstep(0.7, 1.0, dist)) * (1.0 - dist) * (1.0 - v_pulseFactor * 0.6);

    vec3 finalRgb = mix(v_color.rgb, vec3(1.0), coreAlpha * 0.7);
    float finalAlpha = max(coreAlpha, ringAlpha * 0.55) * v_color.a;

    fragColor = vec4(finalRgb, finalAlpha);
}
`;
