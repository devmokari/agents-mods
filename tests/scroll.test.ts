import { expect, test } from 'claude-code/testing'
import { historyWindow, scrolledBack, wheelRows, wrappedRows } from '../hooks/model'

test('rows are estimated from the words wrapped at the bubble width', () => {
  expect(wrappedRows('short', 20)).toBe(1)
  expect(wrappedRows('x'.repeat(45), 20)).toBe(3)
  expect(wrappedRows('a\nb\n\nc', 20)).toBe(4)
})

test('a wheel tick moves three rows; a page or fling moves as asked', () => {
  expect(wheelRows(-1)).toBe(-3)
  expect(wheelRows(2)).toBe(6)
  expect(wheelRows(-37)).toBe(-37)
  expect(wheelRows(122)).toBe(122)
})

test('scrolling back stops at the newest and at the oldest, for ticks and page jumps alike', () => {
  const heights = Array.from({ length: 20 }, () => 4) // 80 rows, a 20-row window: at most 60 back
  expect(scrolledBack(0, 1, heights, 20)).toBe(0)
  expect(scrolledBack(0, -1, heights, 20)).toBe(3)
  expect(scrolledBack(3, -122, heights, 20)).toBe(60)
  expect(scrolledBack(60, 122, heights, 20)).toBe(0)
  expect(scrolledBack(0, -1, [2, 2], 20)).toBe(0)
})

test('the window shows the newest rows, older ones as it scrolls back, and the oldest from the top at the end', () => {
  const heights = Array.from({ length: 20 }, () => 4)
  expect(historyWindow(heights, 0, 20)).toEqual({ start: 15, end: 20, isAtTop: false })
  expect(historyWindow(heights, 8, 20)).toEqual({ start: 13, end: 18, isAtTop: false })
  expect(historyWindow(heights, 60, 20)).toEqual({ start: 0, end: 5, isAtTop: true })
  // Every message is reachable: each index is drawn at some offset from newest to oldest.
  const drawn = new Set<number>()
  for (let back = 0; back <= 60; back += 3) {
    const { start, end } = historyWindow(heights, back, 20)
    for (let index = start; index < end; index += 1) drawn.add(index)
  }
  expect(drawn.size).toBe(20)
  // A short chat fits whole.
  expect(historyWindow([3, 3], 0, 20)).toEqual({ start: 0, end: 2, isAtTop: false })
})
