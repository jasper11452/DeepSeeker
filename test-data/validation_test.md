# DeepSeeker 验证测试文档

这是一个用于验证搜索功能的测试文档。

## 基础功能

这里是一些基础说明文字。

### 简单示例

一个简单的代码示例：

```javascript
console.log("Hello World");
```

## 高级功能

现在进入更复杂的内容。

### 数据处理

#### 数据库操作

这里是三级标题下的内容。

##### Python 异步处理示例

**这是关键测试！** 下面的 Python 代码块嵌套在五级标题下：

```python
async def fetch_data(url):
    """
    异步获取数据的函数
    这个代码块应该能被搜索到！
    """
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()

async def main():
    data = await fetch_data("https://api.example.com/data")
    print(f"Fetched {len(data)} items")
    return data
```

这是测试的核心代码块！

#### 另一个测试

```python
def simple_function():
    return "This is a simple function"
```

## 搜索测试场景

### 场景 1: 嵌套代码块

#### 算法实现

##### 排序算法

```python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n):
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
    return arr
```

### 场景 2: 混合语言

#### JavaScript 示例

```javascript
async function fetchUserData(userId) {
    const response = await fetch(`/api/users/${userId}`);
    return response.json();
}
```

#### Rust 示例

```rust
async fn process_data(input: Vec<u8>) -> Result<String, Error> {
    let result = tokio::task::spawn_blocking(move || {
        String::from_utf8(input)
    }).await?;

    Ok(result?)
}
```

## 深层测试

### Level 1

正文内容。

#### Level 2

更多内容。

##### Level 3 - 关键代码

这是最深层的测试代码：

```python
class DataProcessor:
    """
    数据处理类
    用于测试深层嵌套的类定义能否被搜索到
    """

    def __init__(self, config):
        self.config = config
        self.cache = {}

    async def process(self, data):
        """处理数据的异步方法"""
        if data in self.cache:
            return self.cache[data]

        result = await self._transform(data)
        self.cache[data] = result
        return result

    async def _transform(self, data):
        """内部转换方法"""
        return data.upper()
```

## 特殊字符测试

### 正则表达式

```python
import re

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None
```

## 长代码块测试

### 完整实现

```python
import asyncio
import aiohttp
from typing import List, Dict, Optional

class AsyncSearchEngine:
    """
    异步搜索引擎实现
    这是一个完整的类，用于测试长代码块的搜索
    """

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def search(self, query: str, limit: int = 10) -> List[Dict]:
        """
        执行搜索查询

        Args:
            query: 搜索关键词
            limit: 返回结果数量

        Returns:
            搜索结果列表
        """
        if not self.session:
            raise RuntimeError("Session not initialized")

        url = f"https://api.search.com/v1/search"
        params = {
            "q": query,
            "limit": limit,
            "api_key": self.api_key
        }

        async with self.session.get(url, params=params) as response:
            response.raise_for_status()
            return await response.json()

    async def batch_search(self, queries: List[str]) -> Dict[str, List[Dict]]:
        """批量搜索"""
        tasks = [self.search(q) for q in queries]
        results = await asyncio.gather(*tasks)
        return dict(zip(queries, results))
```

## 结束

测试文档结束。
