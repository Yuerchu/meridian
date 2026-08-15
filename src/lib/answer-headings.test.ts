import { readAnswerHeadings as readHeadings } from './answer-headings'

function turn(html: string): Element {
  const el = document.createElement('div')
  el.setAttribute('data-slot', 'turn')
  el.innerHTML = html
  return el
}

const answer = (inner: string) => `<div data-role="assistant">${inner}</div>`

describe('readHeadings', () => {
  it('reads text and depth in document order', () => {
    const el = turn(answer('<h2>One</h2><p>x</p><h3>Two</h3><h2>Three</h2>'))
    expect(readHeadings(el).map((h) => [h.text, h.level])).toEqual([
      ['One', 1],
      ['Two', 2],
      ['Three', 1],
    ])
  })

  it('measures depth against the answer, not the tag', () => {
    // An answer that opens at `###` is not three levels indented; it is its own
    // top level. The bars get shorter with depth, and depth is relative.
    const el = turn(answer('<h3>a</h3><h4>b</h4>'))
    expect(readHeadings(el).map((h) => h.level)).toEqual([1, 2])
  })

  it('ignores the collapsed process and the pinned steps', () => {
    // A tool result or a reasoning trace can contain any markup at all, and its
    // headings are not part of the answer's structure.
    const el = turn(`
      <div data-slot="turn-content">${answer('<h2>from a tool</h2>')}</div>
      <div data-slot="turn-pinned">${answer('<h2>pinned</h2>')}</div>
      ${answer('<h2>the answer</h2>')}
    `)
    expect(readHeadings(el).map((h) => h.text)).toEqual(['the answer'])
  })

  it('ignores the question, however it was written', () => {
    const el = turn(`
      <div data-role="user"><h2>a pasted document</h2></div>
      ${answer('<h2>the answer</h2>')}
    `)
    expect(readHeadings(el).map((h) => h.text)).toEqual(['the answer'])
  })

  it('drops a heading with nothing to show for it', () => {
    const el = turn(answer('<h2></h2><h2>  </h2><h2>real</h2>'))
    expect(readHeadings(el).map((h) => h.text)).toEqual(['real'])
  })

  it('finds nothing in an answer without headings', () => {
    expect(readHeadings(turn(answer('<p>just prose</p>')))).toEqual([])
  })
})
