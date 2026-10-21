/**
 * 金字塔打印工具
 */

/**
 * 打印金字塔
 * @param {number} levels - 金字塔层数
 * @param {string} char - 打印字符，默认 '*'
 */
export function printPyramid(levels, char = '*') {
  for (let i = 1; i <= levels; i++) {
    const spaces = ' '.repeat(levels - i);
    const stars = char.repeat(2 * i - 1);
    console.log(spaces + stars);
  }
}

/**
 * 返回金字塔字符串数组（不打印）
 * @param {number} levels - 金字塔层数
 * @param {string} char - 打印字符，默认 '*'
 * @returns {string[]}
 */
export function getPyramid(levels, char = '*') {
  const result = [];
  for (let i = 1; i <= levels; i++) {
    const spaces = ' '.repeat(levels - i);
    const stars = char.repeat(2 * i - 1);
    result.push(spaces + stars);
  }
  return result;
}
