export const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * 按权重随机选择元素
 * @param {Array} items - 候选元素数组
 * @param {number[]} weights - 对应的权重数组，与 items 等长
 * @returns {*} 按权重概率随机选中的元素
 */
export const weightedRandom = (items, weights) => {
  // 计算权重总和
  const total = weights.reduce((a, b) => a + b, 0);
  // 生成 [0, total) 范围内的随机数
  let r = Math.random() * total;
  // 逐个减去权重，当 r 降为 0 或负数时命中该元素
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
};

/**
 * 快速排序
 * @param {number[]} arr - 待排序数组
 * @returns {number[]} 排序后的新数组（不修改原数组）
 */
export const quickSort = (arr) => {
  // 基线条件：空数组或单元素直接返回
  if (arr.length <= 1) return arr;
  // 选取第一个元素作为基准值
  const pivot = arr[0];
  // 小于基准的元素归入左侧
  const left = arr.slice(1).filter(x => x < pivot);
  // 大于等于基准的元素归入右侧
  const right = arr.slice(1).filter(x => x >= pivot);
  // 递归排序左右两侧，再拼接基准值
  return [...quickSort(left), pivot, ...quickSort(right)];
};

/**
 * 计算阶乘 n!
 * @param {number} n - 非负整数
 * @returns {number} n 的阶乘结果
 */
export const factorial = (n) => {
  // 负数无阶乘定义
  if (n < 0) throw new Error('n must be non-negative');
  // 0! = 1, 1! = 1
  if (n <= 1) return 1;
  // 迭代计算，避免递归栈溢出
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
};

/**
 * 反转数组（不改变原数组）
 * @param {Array} arr - 待反转数组
 * @returns {Array} 反转后的新数组
 */
export const reverseArray = (arr) => {
  return [...arr].reverse();
};

/**
 * 余弦相似度
 * @param {number[]} a - 向量a
 * @param {number[]} b - 向量b
 * @returns {number} 余弦相似度，范围 [-1, 1]
 */
export const cosineSimilarity = (a, b) => {
  // 两个向量长度必须一致
  if (a.length !== b.length) throw new Error('Vectors must have the same length');
  // 分别累加点积、向量a的模平方、向量b的模平方
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];   // 点积：对应元素相乘再求和
    normA += a[i] * a[i];        // a 的模平方
    normB += b[i] * b[i];        // b 的模平方
  }
  // 分母 = |a| * |b|，零向量时分母为 0，返回 0
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
};

/**
 * 求倒数
 * @param {number} n - 非零数字
 * @returns {number} n 的倒数，即 1/n
 */
export const reciprocal = (n) => {
  // 零没有倒数，直接抛出异常
  if (n === 0) throw new Error('Cannot reciprocal zero');
  // 返回 1/n 即为倒数
  return 1 / n;
};
