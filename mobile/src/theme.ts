/** Web版（app.html）と同じ色。ライトはノート、ダークは黒板 */
const light = {
  paper: '#F1F5F6',
  sheet: '#FFFFFF',
  rule: '#E0E9EC',
  ink: '#1B2731',
  ink2: '#4D5E6A',
  ink3: '#7F8F99',
  blue: '#2350B5',
  blueInk: '#FFFFFF',
  red: '#D02F2B',
  marker: '#F1E46A',
  warn: '#9E5300',
};
const dark: typeof light = {
  paper: '#16221D',
  sheet: '#1D2B25',
  rule: '#2D3F37',
  ink: '#EDF1E9',
  ink2: '#B4C2B9',
  ink3: '#7F9188',
  blue: '#93B6FF',
  blueInk: '#0D1A30',
  red: '#FF8A84',
  marker: '#E3D468',
  warn: '#FFB35E',
};

export function palette(scheme: string | null | undefined) {
  return scheme === 'dark' ? dark : light;
}
