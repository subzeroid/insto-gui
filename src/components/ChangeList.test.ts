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
