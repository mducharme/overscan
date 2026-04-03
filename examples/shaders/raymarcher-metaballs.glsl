vec3 q = p;
q.xz *= rot(u_time * 0.7);
float sphere = sdSphere(q, 0.82);
float torus = sdTorus(vec3(q.x, q.y * 0.8, q.z), vec2(1.08, 0.2));
float box = sdBox(q, vec3(0.42));
return min(min(sphere, torus), box);
