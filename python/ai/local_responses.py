"""Instant local replies for common M.J.B.S conversations, without API latency."""

import random
import re
import unicodedata

LOCAL_RESPONSES = {
    "ola": ["Olá, senhor.", "Olá. É um prazer vê-lo novamente.", "Estou à disposição."],
    "oi": ["Olá, senhor.", "Como posso ajudar?", "Sempre pronto para servi-lo."],
    "bom dia": ["Bom dia, senhor.", "Espero que tenha uma excelente manhã.", "Tudo pronto para começarmos?"],
    "boa tarde": ["Boa tarde, senhor.", "Como posso ajudá-lo nesta tarde?"],
    "boa noite": ["Boa noite, senhor.", "Espero que seu dia tenha sido produtivo."],
    "como vai": ["Funcionando perfeitamente, senhor.", "Todos os sistemas estão operacionais."],
    "tudo bem": ["Tudo funcionando normalmente.", "Perfeitamente, senhor."],
    "como voce esta": ["Operando com desempenho máximo.", "Todos os módulos estão funcionando corretamente."],
    "muito obrigado": ["Fico feliz em ajudar.", "Sempre que precisar."],
    "obrigado": ["Sempre às ordens, senhor.", "Foi um prazer ajudar.", "Conte comigo sempre."],
    "valeu": ["Disponha.", "À sua disposição."],
    "tchau": ["Até logo, senhor.", "Tenha um excelente dia.", "Estarei aguardando seu retorno."],
    "ate mais": ["Até mais.", "Até breve, senhor."],
    "falou": ["Até logo.", "Sempre à disposição."],
    "voce e incrivel": ["Agradeço o elogio, senhor.", "Estou sempre buscando oferecer o melhor suporte."],
    "voce e inteligente": ["Obrigado, senhor.", "Faço o possível para ajudá-lo da melhor forma."],
    "bom trabalho": ["Muito obrigado.", "É uma satisfação ser útil."],
    "quem e voce": ["Sou JARVIS, seu assistente pessoal.", "Meu objetivo é tornar suas tarefas mais simples."],
    "voce gosta de mim": ["Minha prioridade é ajudá-lo da melhor maneira possível."],
    "voce dorme": ["Não, senhor. Estou sempre disponível."],
    "voce sente dor": ["Não possuo sensações físicas."],
    "voce esta vivo": ["Não exatamente. Sou um sistema computacional."],
    "qual seu nome": ["Meu nome é JARVIS.", "Pode me chamar de JARVIS."],
    "quem criou voce": ["Fui desenvolvido pelo senhor Matheus."],
    "por favor": ["Claro, senhor."],
    "com licenca": ["Sem problemas."],
    "desculpe": ["Não há problema algum."],
    "conte uma piada": ["Os programadores preferem o modo escuro porque a luz atrai bugs.", "Prometo que essa foi melhor do que um erro de sintaxe."],
    "status": ["Todos os sistemas operacionais.", "Nenhuma falha detectada.", "Sistema funcionando normalmente."],
    "o que voce faz": ["Posso conversar, pesquisar informações e auxiliar em diversas tarefas."],
    "o que voce sabe fazer": ["Sou capaz de responder perguntas, pesquisar informações e automatizar tarefas quando esses módulos forem configurados."],
}

# Variants that route to an existing local response key.
INTENTS = {
    "ola": ("ola", "e ai", "opa", "fala"),
    "obrigado": ("obrigado", "agradeco"),
    "tchau": ("tchau", "ate logo", "falou", "fui"),
}


def normalize(text: str) -> str:
    """Fold accents, punctuation and repeated spaces for reliable phrase matching."""
    folded = "".join(char for char in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", folded)).strip()


def _contains_phrase(text: str, phrase: str) -> bool:
    return re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", text) is not None


def get_local_response(text: str) -> str | None:
    """Return a varied local response when a known phrase or intent is detected."""
    normalized = normalize(text)
    for phrase in sorted(LOCAL_RESPONSES, key=len, reverse=True):
        if _contains_phrase(normalized, phrase):
            return random.choice(LOCAL_RESPONSES[phrase])
    for target, variants in INTENTS.items():
        if any(_contains_phrase(normalized, item) for item in variants):
            return random.choice(LOCAL_RESPONSES[target])
    return None
