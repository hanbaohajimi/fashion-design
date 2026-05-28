"""
趋势报告 JSON Schema（供 LLM 输出约束与外部系统对接参考）
与 models.py 中的 FashionTrendReport Pydantic 模型保持一致
"""

TREND_REPORT_JSON_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "FashionTrendReport",
    "type": "object",
    "required": [
        "report_date", "time_range", "summary", "key_trends",
        "colors", "fabrics", "silhouettes", "items", "patterns",
        "style_keywords", "consumer_signals", "confidence", "evidence"
    ],
    "properties": {
        "report_date": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
            "description": "报告日期，格式 YYYY-MM-DD"
        },
        "time_range": {
            "type": "string",
            "description": "数据时间范围，如 '2024-06-01 ~ 2024-06-07'"
        },
        "summary": {
            "type": "string",
            "description": "整体趋势摘要，2-4 句话"
        },
        "key_trends": {
            "type": "array",
            "description": "关键趋势列表",
            "items": {
                "type": "object",
                "required": ["name", "description", "confidence"],
                "properties": {
                    "name": {"type": "string", "description": "趋势名称"},
                    "description": {"type": "string", "description": "详细描述"},
                    "supporting_evidence": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["site_name", "article_title", "article_url", "snippet"],
                            "properties": {
                                "site_name": {"type": "string"},
                                "article_title": {"type": "string"},
                                "article_url": {"type": "string", "format": "uri"},
                                "snippet": {"type": "string", "description": "原文引用片段，≤150字"}
                            }
                        }
                    },
                    "related_colors": {"type": "array", "items": {"type": "string"}},
                    "related_fabrics": {"type": "array", "items": {"type": "string"}},
                    "related_items": {"type": "array", "items": {"type": "string"}},
                    "related_patterns": {"type": "array", "items": {"type": "string"}},
                    "related_silhouettes": {"type": "array", "items": {"type": "string"}},
                    "confidence": {
                        "type": "number",
                        "minimum": 0.0,
                        "maximum": 1.0,
                        "description": "置信度 0.0~1.0"
                    }
                }
            }
        },
        "colors": {
            "type": "array",
            "items": {"type": "string"},
            "description": "整体色彩趋势列表"
        },
        "fabrics": {
            "type": "array",
            "items": {"type": "string"},
            "description": "整体面料趋势列表"
        },
        "silhouettes": {
            "type": "array",
            "items": {"type": "string"},
            "description": "整体廓形趋势列表"
        },
        "items": {
            "type": "array",
            "items": {"type": "string"},
            "description": "整体单品趋势列表"
        },
        "patterns": {
            "type": "array",
            "items": {"type": "string"},
            "description": "整体图案趋势列表"
        },
        "style_keywords": {
            "type": "array",
            "items": {"type": "string"},
            "description": "风格关键词"
        },
        "consumer_signals": {
            "type": "array",
            "items": {"type": "string"},
            "description": "消费者信号与行为洞察"
        },
        "confidence": {
            "type": "number",
            "minimum": 0.0,
            "maximum": 1.0,
            "description": "全局置信度"
        },
        "evidence": {
            "type": "array",
            "description": "全局证据来源列表",
            "items": {
                "type": "object",
                "required": ["site_name", "article_title", "article_url", "snippet"],
                "properties": {
                    "site_name": {"type": "string"},
                    "article_title": {"type": "string"},
                    "article_url": {"type": "string"},
                    "snippet": {"type": "string"}
                }
            }
        }
    }
}
