# Location Poems API

一个 Node.js API：访问后由后端使用 IP 库 `whois.pconline.com.cn` 查询访问者或传入 IP 的所在地，并从本地诗文库中匹配相关诗文后直接返回 JSON：

- `poem`：与所在地相关的诗文；从本地 `data/poem-corpus.json` 匹配，同一地区多条时随机返回；仍无匹配时使用兜底诗句
- `location`：`国家 省份 城市 运营商`

## 启动

```bash
npm start
```

监听端口可在 `server.js` 中进行修改，默认为 `3000`

## 接口

### 1. 直接访问，返回 JSON

```http
GET /
GET /poem
```

示例：

```bash
curl "http://localhost:3000/"
```

返回示例：

```json
{
  "poem": "何如只向松江渡，杨柳影边茅屋住",
  "location": "中国 上海 上海 电信"
}
```

### 2. 传入 IP 查询

```http
GET /poem?ip=目标IP
```

示例：

```bash
curl "http://localhost:3000/poem?ip=目标IP"
```

### 3. 可选：直接传入定位字段解析

如果你已经有其他来源的定位字段，也可以不让后端查 IP，直接把定位字段传给后端解析

```http
GET /poem?pro=上海市&city=上海市
```

也支持 POST 风格 JSON：

```bash
curl -X POST "http://localhost:3000/poem" \
  -H "Content-Type: application/json" \
  -d "{\"pro\":\"上海市\",\"city\":\"上海市\"}"
```

## 返回字段

成功时：

```json
{
  "poem": "何如只向松江渡，杨柳影边茅屋住",
  "location": "中国 上海 上海"
}
```

失败时仍会返回兜底诗句：

```json
{
  "poem": "海内存知己，天涯若比邻",
  "location": "",
  "error": "错误原因"
}
```

## 覆盖策略

- 匹配顺序：`region` → `city` → `province` 精确匹配；如果某个地名存在但诗文数组为空，会继续向上级回退，避免因为空数组直接失败
- 兜底策略：若所在地在本地诗文库中没有可用条目，则随机返回通用兜底诗句

## 说明

- 本项目使用 Node.js 18+ 内置 `fetch` 和 `http`，运行时无第三方 npm 依赖
- 诗文库完全来自 `data/poem-corpus.json`
- IP 定位接口为 `https://whois.pconline.com.cn/ipJson.jsp`
- 生产环境如需商业 SLA、更高频率限制或境外 IP 更完整信息，建议接入正式商业 IP 定位服务或增加多源兜底
- 如果服务部署在反向代理后，请确保代理正确传递 `X-Forwarded-For` 或 `X-Real-IP`
