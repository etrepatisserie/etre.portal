export async function mapEach(list, fn) {
  const out = [];
  for (let i = 0; i < list.length; i++) out.push(await fn(list[i], i));
  return out;
}

export async function filterEach(list, fn) {
  const out = [];
  for (let i = 0; i < list.length; i++) if (await fn(list[i], i)) out.push(list[i]);
  return out;
}

export async function findEach(list, fn) {
  for (let i = 0; i < list.length; i++) if (await fn(list[i], i)) return list[i];
  return undefined;
}

export async function forEach(list, fn) {
  for (let i = 0; i < list.length; i++) await fn(list[i], i);
}
