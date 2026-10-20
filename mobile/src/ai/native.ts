/**
 * 端末AIの部品（llama.rn のネイティブ部分）がアプリに入っているかを確かめる
 *
 *  Expo Go や、llama.rn を入れる前に作ったビルドでは入っていない。
 *  そのまま呼ぶと「Cannot read property 'install' of null」になるので、先に確かめて分かる言葉で知らせる。
 */
import { TurboModuleRegistry } from 'react-native';

export function hasLlamaNative(): boolean {
  try {
    return !!TurboModuleRegistry.get('RNLlama');
  } catch {
    return false;
  }
}

export const NO_NATIVE_MESSAGE =
  'このアプリには端末AIの部品が入っていません。Expo Go では動かないので、build-android.cmd で作った「開発ビルド」のアプリで開いてください。';
