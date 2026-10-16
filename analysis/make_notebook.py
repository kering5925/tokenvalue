from pathlib import Path

import nbformat as nbf


root = Path(__file__).resolve().parents[1]
notebook_path = root / "analysis" / "signal_backtest.ipynb"
nb = nbf.v4.new_notebook()
nb["metadata"]["kernelspec"] = {"display_name": "Python 3", "language": "python", "name": "python3"}
nb["metadata"]["language_info"] = {"name": "python", "version": "3"}
nb["cells"] = [
    nbf.v4.new_markdown_cell("""# ETH / CRCLB 短线信号回测与参数优化

目标：验证当前信号在真实后续价格上的表现，并在严格的时间切分下寻找更稳健的参数。

- 数据：Binance 公共 5m、15m、1h 已收盘 K 线，自 2026-06-11 起。
- 交易定义：信号于 15m 收盘确认，固定持有 2 小时；持仓期间忽略重复信号。
- 成本：单边手续费 0.25%，每笔完整交易扣除 0.50%。
- 防过拟合：前 70% 仅用于选参数，后 30% 作为完全未参与调参的样本外验证。
- “卖出成功”：按可做空口径，2 小时后的空头净收益大于 0；若只用于减仓，也等价于价格跌幅超过成本。

注意：短历史、单一市场阶段的结果不能保证未来收益。参数排序以 Wilson 置信下界为主，并要求训练集至少 20 笔非重叠交易。"""),
    nbf.v4.new_code_cell("""from pathlib import Path
import sys

project_root = Path.cwd().resolve()
if project_root.name == 'analysis':
    project_root = project_root.parent
sys.path.insert(0, str(project_root / 'analysis'))

from backtest_core import run_analysis
results, selected_parameters = run_analysis(refresh=False)"""),
    nbf.v4.new_markdown_cell("""## 阅读结果的方法

优先看“验证集”的交易数、命中率与平均净收益。若优化规则只提高命中率、但平均净收益仍小于零，说明它没有克服交易成本；若交易数很少，则结论不稳，应继续积累数据。Profit Factor 大于 1 才表示总盈利超过总亏损。"""),
]
nbf.write(nb, notebook_path)
print(notebook_path)
