vec3 q = p;
q.y -= 0.15;
q.xz *= rot(u_time * 0.25);
float pedestal = sdBox(q - vec3(0.0, -0.7, 0.0), vec3(0.9, 0.18, 0.9));
float column = sdBox(q, vec3(0.26, 0.9, 0.26));
float crown = sdTorus(q - vec3(0.0, 0.75, 0.0), vec2(0.5, 0.12));
float orb = sdSphere(q - vec3(0.0, 1.15 + sin(u_time * 0.8) * 0.08, 0.0), 0.28);
return min(min(pedestal, column), min(crown, orb));
