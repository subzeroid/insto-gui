import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GeoMap from './GeoMap.vue'
import { t } from '../i18n'

const place = (name: string, lat: number, lng: number, count = 1) => ({ name, lat, lng, count })
const map = (places: ReturnType<typeof place>[]) => mount(GeoMap, { props: { places } })
const position = (wrapper: ReturnType<typeof map>, index: number) => {
  const dot = wrapper.findAll('.map-location .map-dot')[index]
  return [Number(dot.attributes('cx')), Number(dot.attributes('cy'))]
}

describe('geotagged posts map', () => {
  it('projects the equator and both poles without Mercator clipping', () => {
    const wrapper = map([place('Origin', 0, 0), place('North', 90, 0), place('South', -90, 0), place('Tokyo', 35.7, 139.7)])
    expect(position(wrapper, 0)).toEqual([180, 90])
    expect(position(wrapper, 1)).toEqual([180, 0])
    expect(position(wrapper, 2)).toEqual([180, 180])
    expect(position(wrapper, 3)[0]).toBeCloseTo(319.7)
    expect(position(wrapper, 3)[1]).toBeCloseTo(54.3)
    expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 360 180')
    expect(wrapper.findAll('.map-land').length).toBeGreaterThan(5)
    expect(wrapper.findAll('.map-grid line').length).toBeGreaterThan(10)
    expect(wrapper.findAll('img, image, canvas, iframe').length).toBe(0)
  })

  it('wraps longitudes and ignores coordinates that cannot be projected', () => {
    const wrapper = map([place('Wrapped', 0, 540), place('West', 0, -180), place('Missing', Number.NaN, 1), place('Infinite', 0, Number.POSITIVE_INFINITY)])
    expect(wrapper.findAll('.map-location')).toHaveLength(2)
    expect(position(wrapper, 0)).toEqual(position(wrapper, 1))
    expect(position(wrapper, 0)).toEqual([0, 90])
  })

  it('selects a named location by mouse, Enter, or Space and exposes its exact count', async () => {
    const wrapper = map([place('Harbour', 52.37, 4.89, 12), place('Garden', 50, 15, 2)])
    const points = wrapper.findAll('.map-location')
    expect(points[0].attributes('role')).toBe('button')
    expect(points[0].attributes('tabindex')).toBe('0')
    expect(points[0].attributes('aria-label')).toBe(t('lookup.map_location', { name: 'Harbour', count: '12' }))
    await points[0].trigger('click')
    expect(wrapper.get('.map-selection').text()).toBe(t('lookup.map_location', { name: 'Harbour', count: '12' }))
    expect(points[0].attributes('aria-pressed')).toBe('true')
    await points[1].trigger('keydown', { key: 'Enter' })
    expect(points[1].attributes('aria-pressed')).toBe('true')
    expect(points[0].attributes('aria-pressed')).toBe('false')
    await points[0].trigger('keydown', { key: ' ' })
    expect(points[0].attributes('aria-pressed')).toBe('true')
  })

  it('makes overlapping places directly selectable with names, coordinates and counts', async () => {
    const wrapper = map([place('Harbour', 52.37, 4.89, 12), place('Garden', 52.37, 4.89, 2), place('Museum', 35.7, 139.7, 3)])
    const picker = wrapper.get('select')
    expect(wrapper.get(`label[for="${picker.attributes('id')}"]`).text()).toBe(t('lookup.map_selection_hint'))
    const options = picker.findAll('option').slice(1)
    expect(options).toHaveLength(3)
    expect(options[0].text()).toContain(t('lookup.map_location', { name: 'Harbour', count: '12' }))
    expect(options[0].text()).toContain('52.3700, 4.8900')
    expect(options[1].text()).toContain(t('lookup.map_location', { name: 'Garden', count: '2' }))
    await picker.setValue('0')
    expect(wrapper.get('.map-selection').text()).toBe(t('lookup.map_location', { name: 'Harbour', count: '12' }))
    await picker.setValue('1')
    expect(wrapper.get('.map-selection').text()).toBe(t('lookup.map_location', { name: 'Garden', count: '2' }))
    await wrapper.get('[data-action="zoom-in"]').trigger('click')
    const before = wrapper.get('svg').attributes('viewBox')
    await picker.setValue('2')
    expect(wrapper.get('svg').attributes('viewBox')).not.toBe(before)
    expect(wrapper.findAll('.map-location')[2].attributes('aria-pressed')).toBe('true')
    await wrapper.findAll('.map-location')[0].trigger('keydown', { key: 'Enter' })
    expect((picker.element as HTMLSelectElement).value).toBe('0')
  })

  it('zooms around selection, wraps nearby points across the antimeridian and resets the world', async () => {
    const wrapper = map([place('East island', 10, 179), place('West island', 10, -179)])
    const zoomIn = wrapper.get('[data-action="zoom-in"]')
    const zoomOut = wrapper.get('[data-action="zoom-out"]')
    expect(zoomOut.attributes('disabled')).toBeDefined()
    expect(zoomIn.attributes('aria-label')).toBe(t('lookup.map_zoom_in'))
    await wrapper.findAll('.map-location')[0].trigger('click')
    await zoomIn.trigger('click')
    const box = wrapper.get('svg').attributes('viewBox')!.split(' ').map(Number)
    expect(box[2]).toBe(180)
    expect(box[3]).toBe(90)
    expect(Math.abs(position(wrapper, 0)[0] - position(wrapper, 1)[0])).toBe(2)
    expect(box[0]).toBeGreaterThan(180)
    await zoomIn.trigger('click')
    await zoomIn.trigger('click')
    expect(zoomIn.attributes('disabled')).toBeDefined()
    await wrapper.get('[data-action="reset"]').trigger('click')
    expect(wrapper.get('svg').attributes('viewBox')).toBe('0 0 360 180')
    expect(zoomOut.attributes('disabled')).toBeDefined()
  })

  it('clears stale selection when a new sample arrives and has an explicit empty state', async () => {
    const wrapper = map([place('Old sample', 0, 0)])
    await wrapper.get('.map-location').trigger('click')
    await wrapper.setProps({ places: [place('New sample', 1, 1)] })
    expect(wrapper.get('.map-selection').text()).toBe(t('lookup.map_selection_hint'))
    await wrapper.setProps({ places: [] })
    expect(wrapper.get('.map-empty').text()).toBe(t('lookup.map_empty'))
    expect(wrapper.find('svg').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
