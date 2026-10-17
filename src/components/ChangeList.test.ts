import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChangeList from './ChangeList.vue'
import type { Change } from '../desktop/dto'

const A = 'a'.repeat(64), B = 'b'.repeat(64)
const render = (changes: Change[]) => mount(ChangeList, { props: { changes, unknownFields: [] } })

describe('change list', () => {
  it('names a picture change instead of printing two hashes', () => {
    const view = render([{ field: 'avatar', old: A, new: B }, { field: 'banner', old: null, new: B }, { field: 'avatar', old: A, new: null }].slice(0, 2) as Change[])
    const text = view.text()
    expect(text).toContain('Profile picture')
    expect(text).toContain('Replaced with a new one')
    expect(text).toContain('Banner')
    expect(text).toContain('Added')
    expect(text).not.toContain(A)
    expect(text).not.toContain(B)
    expect(text).not.toContain('hash')
  })
  it('says when a picture was removed', () => {
    expect(render([{ field: 'avatar', old: A, new: null }] as Change[]).text()).toContain('Removed')
  })
  it('still spells out every other field', () => {
    const text = render([{ field: 'follower_count', old: 18392, new: 18507 }] as Change[]).text()
    expect(text).toContain('18,392')
    expect(text).toContain('18,507')
  })
})

it('shows posts-only changes and labels a full recent-post window without inventing deletions', () => {
  const view = mount(ChangeList, { props: { changes: [], unknownFields: [], posts: { added: ['123', '456789'], window_full: true } } })
  expect(view.text()).toContain('New posts in this sample: 2')
  expect(view.text()).toContain('123')
  expect(view.text()).toContain('456789')
  expect(view.text()).toContain('Every post in this recent window is new; more new posts may exist beyond this sample.')
  expect(view.text()).not.toContain('deleted')
})
