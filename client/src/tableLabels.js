// Phones show table rows as stacked cards (styles/pages.css). Each cell needs its column name,
// so this copies the header text onto every body cell as data-label — for every table on the page,
// including rows that load later. Tables with class "no-stack" are left alone.
export function labelTables(root) {
  for (const table of root.querySelectorAll('table:not(.no-stack)')) {
    const head = table.tHead?.rows[0]
    if (!head) continue
    const names = []
    for (const th of head.cells) for (let k = 0; k < (th.colSpan || 1); k++) names.push(th.textContent.trim())
    table.classList.add('stackable')
    for (const body of table.tBodies) {
      for (const row of body.rows) {
        let col = 0
        for (const td of row.cells) {
          const name = td.colSpan > 1 ? '' : names[col] || ''
          if (td.dataset.label !== name) td.dataset.label = name
          col += td.colSpan || 1
        }
      }
    }
  }
}

export function watchTables(root) {
  if (!root) return () => {}
  let queued = false
  const run = () => { queued = false; labelTables(root) }
  run()
  const mo = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run) } })
  mo.observe(root, { childList: true, subtree: true })
  return () => mo.disconnect()
}
