#!/usr/bin/env python3
"""
Gera a apresentação PowerPoint do manual:
"Presença Digital Profissional para Negócios"

Uso:
    python criar_apresentacao.py

Saída:
    Presenca_Digital_Profissional.pptx (mesma pasta)
"""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt, Emu

# ── Paleta ──────────────────────────────────────────────────────────────────
BLUE = RGBColor(0x0B, 0x5B, 0xA2)
RED = RGBColor(0xD5, 0x23, 0x2B)
ORANGE = RED  # alias: acentos que eram laranja passam a vermelho
GRAY = RGBColor(0x5D, 0x5D, 0x5D)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT_BLUE = RGBColor(0xE3, 0xEE, 0xF7)
LIGHT_ORANGE = RGBColor(0xFB, 0xE8, 0xE9)  # fundo suave do vermelho
LIGHT_GRAY = RGBColor(0xF5, 0xF5, 0xF5)
DARK = RGBColor(0x2A, 0x2A, 0x2A)

# Tipografia (fallback automático se a fonte não estiver instalada)
FONT_TITLE = "Montserrat"
FONT_BODY = "Open Sans"
FONT_FALLBACK_TITLE = "Calibri"
FONT_FALLBACK_BODY = "Calibri"

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

OUT = Path(__file__).resolve().parent / "Presenca_Digital_Profissional.pptx"


def _font(run, name, size, bold=False, color=DARK):
    run.font.name = name
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color


def _set_run(paragraph, text, font, size, bold=False, color=DARK):
    run = paragraph.add_run()
    run.text = text
    _font(run, font, size, bold, color)
    return run


def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])  # blank


def _rect(slide, left, top, width, height, fill):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.fill.background()
    return shape


def _round_rect(slide, left, top, width, height, fill):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.fill.background()
    return shape


def _bar(slide, color=ORANGE, height=Inches(0.12)):
    return _rect(slide, 0, 0, SLIDE_W, height, color)


def _footer(slide, page, total):
    _rect(slide, 0, Inches(7.15), SLIDE_W, Inches(0.35), BLUE)
    box = slide.shapes.add_textbox(Inches(0.4), Inches(7.18), Inches(10), Inches(0.28))
    p = box.text_frame.paragraphs[0]
    _set_run(p, "Presença Digital Profissional para Negócios", FONT_BODY, 10, False, WHITE)
    num = slide.shapes.add_textbox(Inches(11.5), Inches(7.18), Inches(1.5), Inches(0.28))
    np = num.text_frame.paragraphs[0]
    np.alignment = PP_ALIGN.RIGHT
    _set_run(np, f"{page} / {total}", FONT_BODY, 10, False, WHITE)


def _title_block(slide, title, subtitle=None):
    _bar(slide)
    _rect(slide, 0, Inches(0.12), Inches(0.18), Inches(1.1), BLUE)
    box = slide.shapes.add_textbox(Inches(0.5), Inches(0.28), Inches(12.3), Inches(0.55))
    p = box.text_frame.paragraphs[0]
    _set_run(p, title, FONT_TITLE, 28, True, BLUE)
    if subtitle:
        sub = slide.shapes.add_textbox(Inches(0.5), Inches(0.85), Inches(12.3), Inches(0.35))
        sp = sub.text_frame.paragraphs[0]
        _set_run(sp, subtitle, FONT_BODY, 14, False, GRAY)


def _bullets(slide, items, left=0.5, top=1.4, width=12.3, height=5.4, size=16, color=DARK):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.level = 0
        p.space_after = Pt(8)
        text = item if isinstance(item, str) else item[0]
        level = 0 if isinstance(item, str) else item[1]
        p.level = level
        prefix = "•  " if level == 0 else "–  "
        _set_run(p, prefix + text, FONT_BODY, size if level == 0 else size - 1, False, color if level == 0 else GRAY)
    return box


def _cards(slide, cards, top=1.5, card_h=1.6):
    """cards: list of (title, body) — up to 4 horizontal cards."""
    n = len(cards)
    gap = 0.25
    margin = 0.5
    usable = 13.333 - 2 * margin - gap * (n - 1)
    w = usable / n
    for i, (title, body) in enumerate(cards):
        left = margin + i * (w + gap)
        shape = _round_rect(slide, Inches(left), Inches(top), Inches(w), Inches(card_h), LIGHT_BLUE)
        # accent top
        _rect(slide, Inches(left), Inches(top), Inches(w), Inches(0.08), ORANGE if i % 2 else BLUE)
        tbox = slide.shapes.add_textbox(Inches(left + 0.15), Inches(top + 0.2), Inches(w - 0.3), Inches(0.4))
        tp = tbox.text_frame.paragraphs[0]
        _set_run(tp, title, FONT_TITLE, 13, True, BLUE)
        bbox = slide.shapes.add_textbox(Inches(left + 0.15), Inches(top + 0.65), Inches(w - 0.3), Inches(card_h - 0.8))
        bp = bbox.text_frame
        bp.word_wrap = True
        bp.paragraphs[0].text = ""
        _set_run(bp.paragraphs[0], body, FONT_BODY, 11, False, GRAY)


def _two_col(slide, left_items, right_items, left_title, right_title, top=1.4):
    # left panel
    _round_rect(slide, Inches(0.4), Inches(top), Inches(6.0), Inches(5.3), LIGHT_GRAY)
    lt = slide.shapes.add_textbox(Inches(0.6), Inches(top + 0.2), Inches(5.6), Inches(0.4))
    _set_run(lt.text_frame.paragraphs[0], left_title, FONT_TITLE, 16, True, BLUE)
    _bullets(slide, left_items, left=0.6, top=top + 0.7, width=5.6, height=4.4, size=14)

    # right panel
    _round_rect(slide, Inches(6.8), Inches(top), Inches(6.0), Inches(5.3), LIGHT_ORANGE)
    rt = slide.shapes.add_textbox(Inches(7.0), Inches(top + 0.2), Inches(5.6), Inches(0.4))
    _set_run(rt.text_frame.paragraphs[0], right_title, FONT_TITLE, 16, True, ORANGE)
    _bullets(slide, right_items, left=7.0, top=top + 0.7, width=5.6, height=4.4, size=14)


def _exercise_slide(slide, number, title, tasks):
    _bar(slide, ORANGE)
    _rect(slide, 0, Inches(0.12), Inches(0.18), Inches(1.1), ORANGE)
    badge = _round_rect(slide, Inches(0.5), Inches(0.3), Inches(2.4), Inches(0.45), ORANGE)
    bt = slide.shapes.add_textbox(Inches(0.5), Inches(0.35), Inches(2.4), Inches(0.4))
    bp = bt.text_frame.paragraphs[0]
    bp.alignment = PP_ALIGN.CENTER
    _set_run(bp, f"EXERCÍCIO {number}", FONT_TITLE, 12, True, WHITE)

    tbox = slide.shapes.add_textbox(Inches(3.1), Inches(0.32), Inches(9.5), Inches(0.45))
    _set_run(tbox.text_frame.paragraphs[0], title, FONT_TITLE, 22, True, BLUE)

    _bullets(slide, tasks, top=1.3, size=18)


def _section_divider(slide, module_num, module_title, tagline=""):
    _rect(slide, 0, 0, SLIDE_W, SLIDE_H, BLUE)
    _rect(slide, 0, Inches(6.8), SLIDE_W, Inches(0.7), ORANGE)
    num = slide.shapes.add_textbox(Inches(0.8), Inches(2.0), Inches(11.5), Inches(0.6))
    np = num.text_frame.paragraphs[0]
    _set_run(np, f"MÓDULO {module_num}", FONT_TITLE, 18, True, ORANGE)
    title = slide.shapes.add_textbox(Inches(0.8), Inches(2.7), Inches(11.5), Inches(1.2))
    tp = title.text_frame.paragraphs[0]
    _set_run(tp, module_title, FONT_TITLE, 36, True, WHITE)
    if tagline:
        tag = slide.shapes.add_textbox(Inches(0.8), Inches(4.1), Inches(11.5), Inches(0.6))
        _set_run(tag.text_frame.paragraphs[0], tagline, FONT_BODY, 16, False, LIGHT_BLUE)


def _checklist(slide, items, left=0.5, top=1.4, width=12.3, size=15):
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(5.4))
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(6)
        _set_run(p, f"☐  {item}", FONT_BODY, size, False, DARK)


# ═══════════════════════════════════════════════════════════════════════════
# SLIDES
# ═══════════════════════════════════════════════════════════════════════════

def build():
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    slides_meta = []  # (builder_fn) — we build then add footers with total

    builders = []

    # ── CAPA ──────────────────────────────────────────────────────────────
    def capa(s):
        _rect(s, 0, 0, SLIDE_W, SLIDE_H, BLUE)
        _rect(s, 0, Inches(5.8), SLIDE_W, Inches(1.7), ORANGE)
        t = s.shapes.add_textbox(Inches(0.8), Inches(2.2), Inches(11.5), Inches(1.5))
        tp = t.text_frame
        tp.word_wrap = True
        p = tp.paragraphs[0]
        _set_run(p, "Presença Digital Profissional\npara Negócios", FONT_TITLE, 40, True, WHITE)
        sub = s.shapes.add_textbox(Inches(0.8), Inches(4.5), Inches(11.5), Inches(0.5))
        _set_run(sub.text_frame.paragraphs[0], "Manual de Formação Prática · Canva · Redes Sociais · Email · Integração", FONT_BODY, 16, False, LIGHT_BLUE)
        foot = s.shapes.add_textbox(Inches(0.8), Inches(6.2), Inches(11.5), Inches(0.8))
        fp = foot.text_frame
        _set_run(fp.paragraphs[0], "Design: Azul #0B5BA2  ·  Vermelho #D5232B  ·  Cinza #5D5D5D", FONT_BODY, 12, False, WHITE)
        p2 = fp.add_paragraph()
        _set_run(p2, "Tipografia: Montserrat Bold (títulos)  ·  Open Sans Regular (texto)", FONT_BODY, 12, False, WHITE)

    builders.append(("capa", capa, False))

    # ── ÍNDICE ────────────────────────────────────────────────────────────
    def indice(s):
        _title_block(s, "Índice Geral", "11 módulos · da identidade visual ao plano de ação")
        mods = [
            "0 — Introdução",
            "1 — Canva: Identidade Visual",
            "2 — Facebook: Perfil Profissional",
            "3 — LinkedIn: Rede Profissional",
            "4 — Instagram: Visual e Engagement",
            "5 — WhatsApp Business",
            "6 — Email Corporativo",
            "7 — Integração e Consistência",
            "8 — Gestão e Planeamento",
            "9 — Sessão Prática",
            "10 — Plano de Ação Pessoal",
            "11 — Recursos e Anexos",
        ]
        # two columns
        mid = 6
        _bullets(s, mods[:mid], left=0.5, top=1.5, width=6, height=5, size=16)
        _bullets(s, mods[mid:], left=7.0, top=1.5, width=5.8, height=5, size=16)

    builders.append(("indice", indice, True))

    # ── MÓDULO 0 ──────────────────────────────────────────────────────────
    def m0_div(s):
        _section_divider(s, "0", "Introdução", "Porquê investir numa presença digital profissional?")

    def m0_obj(s):
        _title_block(s, "Objetivos da Formação", "No final deste percurso será capaz de…")
        _bullets(s, [
            "Criar e aplicar uma identidade visual consistente (Canva)",
            "Otimizar perfis profissionais nas principais plataformas",
            "Configurar WhatsApp Business e email corporativo",
            "Integrar canais com nomes, visuais e mensagens alinhados",
            "Planear conteúdo e medir resultados com KPIs claros",
            "Sair com um plano de ação pessoal de 30 dias",
        ])

    def m0_imp(s):
        _title_block(s, "A Importância da Presença Digital", "Primeira impressão online = credibilidade do negócio")
        _cards(s, [
            ("Confiança", "Clientes procuram online antes de comprar. Perfis incompletos afastam."),
            ("Consistência", "Mesma marca em todos os canais reforça reconhecimento e profissionalismo."),
            ("Oportunidade", "Contacto direto (WhatsApp, email, DM) transforma visitas em negócios."),
            ("Competição", "Quem não está bem representado online perde para quem está."),
        ], top=1.5, card_h=2.2)
        note = s.shapes.add_textbox(Inches(0.5), Inches(4.2), Inches(12.3), Inches(2.2))
        tf = note.text_frame
        tf.word_wrap = True
        _set_run(tf.paragraphs[0], "Identidade visual e consistência de marca", FONT_TITLE, 16, True, BLUE)
        p = tf.add_paragraph()
        p.space_before = Pt(10)
        _set_run(p, "Cores, tipografia, tom de voz e logótipo devem ser os mesmos em Canva, redes, WhatsApp e email. "
                    "Começamos pelo Canva porque aí criamos os elementos que vamos reutilizar em todas as plataformas.",
                 FONT_BODY, 14, False, GRAY)

    builders += [("m0d", m0_div, False), ("m0o", m0_obj, True), ("m0i", m0_imp, True)]

    # ── MÓDULO 1 CANVA ────────────────────────────────────────────────────
    def m1_div(s):
        _section_divider(s, "1", "Canva — Identidade Visual", "Criamos aqui o que vamos usar em todas as plataformas")

    def m1_intro(s):
        _title_block(s, "1.1 Introdução ao Canva", "Ferramenta de design acessível para não-designers")
        _two_col(s,
            ["Editor visual drag-and-drop", "Milhares de templates prontos", "Brand Kit para guardar marca",
             "Exportação PNG, JPG, PDF", "Colaboração em equipa (Pro)"],
            ["Gratuito: excelente para começar", "Pro: Brand Kit avançado, remoção de fundo, mais stock",
             "Comece no gratuito e evolua se precisar", "Evite elementos premium se não tiver Pro"],
            "O que é e vantagens", "Gratuito vs Pro")

    def m1_nav(s):
        _title_block(s, "Interface e Navegação Básica", "Familiarize-se com o ambiente de trabalho")
        _bullets(s, [
            "Home — projetos recentes e pesquisa de templates",
            "Criar design — escolher dimensões ou templates",
            "Barra lateral — elementos, texto, uploads, marca",
            "Canvas central — área de edição",
            "Topo — partilhar, descarregar, redimensionar",
            "Dica: organize projetos em pastas por plataforma (Facebook, Instagram, etc.)",
        ])

    def m1_kit(s):
        _title_block(s, "1.2 Kit de Marca no Canva", "Paleta · Tipografia · Logótipo · Brand Kit")
        _cards(s, [
            ("Cores", "3–5 cores no máximo.\nPrincipal, secundária, neutra, fundo."),
            ("Fontes", "Máximo 2–3 tipografias.\nTítulos + texto + opcional acento."),
            ("Logótipo", "Upload em PNG com fundo transparente."),
            ("Brand Kit", "Guardar tudo para reutilizar em segundos."),
        ], top=1.5, card_h=2.4)
        tip = s.shapes.add_textbox(Inches(0.5), Inches(4.3), Inches(12.3), Inches(2))
        tf = tip.text_frame
        tf.word_wrap = True
        _set_run(tf.paragraphs[0], "Paleta sugerida deste manual", FONT_TITLE, 14, True, BLUE)
        p = tf.add_paragraph()
        p.space_before = Pt(8)
        _set_run(p, "Azul profissional #0B5BA2  ·  Vermelho #D5232B  ·  Cinza #5D5D5D  ·  Branco #FFFFFF",
                 FONT_BODY, 14, False, GRAY)
        p2 = tf.add_paragraph()
        p2.space_before = Pt(8)
        _set_run(p2, "Tipografia: Montserrat Bold (títulos) + Open Sans Regular (corpo)", FONT_BODY, 14, False, GRAY)

    def m1_templates(s):
        _title_block(s, "1.3 Templates Essenciais a Criar", "Dimensões corretas = qualidade em todas as redes")
        items = [
            "Foto de perfil profissional — 400×400 px",
            "Capa Facebook — 820×312 px",
            "Capa LinkedIn — 1584×396 px",
            "Posts Instagram — 1080×1080 px",
            "Stories — 1080×1920 px",
            "Assinatura de email — 600×200 px",
            "Cartão digital de contacto",
        ]
        _bullets(s, items, top=1.4, size=17)

    def m1_bp(s):
        _title_block(s, "1.4 Boas Práticas no Canva", "Consistência e organização poupam horas")
        _bullets(s, [
            "Manter consistência visual (cores, fontes, margens)",
            "Criar pasta organizada com templates reutilizáveis",
            "Preferir elementos gratuitos se não tiver Canva Pro",
            "Exportar no formato certo: PNG (transparência/logo), JPG (fotos/posts), PDF (impressão)",
            "Nomear ficheiros de forma clara: marca_plataforma_tipo_v1",
            "Não sobrecarregar designs — menos elementos = mais profissional",
        ])

    def m1_ex(s):
        _exercise_slide(s, "1", "Kit de marca e primeiros visuais", [
            "Criar o kit de marca pessoal/empresarial (cores, fontes, logo)",
            "Criar foto de perfil profissional (400×400)",
            "Criar 3 templates de publicações (feed)",
        ])

    builders += [
        ("m1d", m1_div, False), ("m1i", m1_intro, True), ("m1n", m1_nav, True),
        ("m1k", m1_kit, True), ("m1t", m1_templates, True), ("m1b", m1_bp, True),
        ("m1e", m1_ex, True),
    ]

    # ── MÓDULO 2 FACEBOOK ─────────────────────────────────────────────────
    def m2_div(s):
        _section_divider(s, "2", "Facebook — Perfil Profissional", "Página de empresa clara, completa e ativa")

    def m2_cfg(s):
        _title_block(s, "2.1 Configuração Inicial", "Perfil pessoal ≠ Página empresarial")
        _two_col(s,
            ["Uso pessoal / rede de amigos", "Não ideal para publicidade paga",
             "Limitações de insights", "Mistura vida pessoal e negócio"],
            ["Representa o negócio", "Acesso a Meta Business Suite",
             "Avaliações, CTA, loja, insights", "Vários administradores possíveis"],
            "Perfil Pessoal", "Página Empresarial")

    def m2_vis(s):
        _title_block(s, "2.2 Elementos Visuais", "Reutilizar materiais criados no Canva")
        _bullets(s, [
            "Upload da foto de perfil (do Canva) — nítida e centrada",
            "Upload da capa (820×312) — sem texto cortado nas laterais",
            "Verificar qualidade no telemóvel e no desktop",
            "Alinhar com a mesma identidade das outras redes",
        ])

    def m2_info(s):
        _title_block(s, "2.3 Informações Essenciais", "Complete 100% do perfil — é a sua vitrine")
        _bullets(s, [
            "Nome da página — claro e encontrável",
            "Categoria do negócio",
            "Descrição curta (≈160 caracteres) + Sobre completo (história e proposta de valor)",
            "Horário de funcionamento",
            "Localização (se aplicável)",
            "Website e contactos (telefone, email, WhatsApp)",
        ])

    def m2_sec(s):
        _title_block(s, "2.4 Secções a Ativar", "Funcionalidades que geram confiança e conversão")
        _cards(s, [
            ("Serviços / Produtos", "Mostre o que vende de forma clara."),
            ("Avaliações", "Ative e responda sempre — positivo ou negativo."),
            ("Loja", "Se aplicável, ligue catálogo ou loja."),
            ("Botão CTA", "Mensagem, ligar, reservar, comprar…"),
        ], top=1.5, card_h=2.5)

    def m2_bp(s):
        _title_block(s, "2.5–2.6 Boas Práticas e Conteúdo", "Frequência + relevância = crescimento")
        _two_col(s,
            ["@ profissional e URL personalizado", "Responder mensagens em < 24h",
             "Publicar mínimo 3×/semana", "2–3 hashtags relevantes",
             "Tom alinhado com a marca"],
            ["Tipos: educativo, oferta, bastidores, prova social",
             "Horários: testar com Insights",
             "Interagir com comentários e partilhas",
             "Facebook Insights: alcance, engagement, audiência"],
            "Boas práticas", "Conteúdo profissional")

    def m2_ex(s):
        _exercise_slide(s, "2", "Otimizar a Página de Facebook", [
            "Otimizar página (visuais + informações completas)",
            "Preencher todas as secções essenciais",
            "Criar calendário de 1 semana de publicações",
        ])

    builders += [
        ("m2d", m2_div, False), ("m2c", m2_cfg, True), ("m2v", m2_vis, True),
        ("m2i", m2_info, True), ("m2s", m2_sec, True), ("m2b", m2_bp, True),
        ("m2e", m2_ex, True),
    ]

    # ── MÓDULO 3 LINKEDIN ─────────────────────────────────────────────────
    def m3_div(s):
        _section_divider(s, "3", "LinkedIn — Rede Profissional", "Networking, autoridade e oportunidades de negócio")

    def m3_imp(s):
        _title_block(s, "3.1 Importância do LinkedIn", "A rede profissional mais relevante")
        _bullets(s, [
            "Rede profissional nº 1 a nível global",
            "Perfil pessoal vs Página de empresa — ambos importam",
            "Oportunidades: networking, recrutamento, parcerias, leads B2B",
            "Conteúdo de valor constrói autoridade mais depressa do que publicidade isolada",
        ])

    def m3_perfil(s):
        _title_block(s, "3.2 Perfil Pessoal Profissional", "O seu CV vivo — otimize cada campo")
        _bullets(s, [
            "Foto de perfil e capa (do Canva)",
            "Título profissional impactante (até 220 caracteres)",
            "Resumo / Sobre otimizado — quem é, o que faz, para quem, resultado",
            "Experiência profissional detalhada (resultados, não só tarefas)",
            "Formação e certificações",
            "Competências — mínimo 5 (peça validações)",
        ])

    def m3_page(s):
        _title_block(s, "3.3–3.4 Página de Empresa e URL", "Presença institucional + link limpo")
        _two_col(s,
            ["Criar página de empresa", "Logo + capa consistentes",
             "Slogan claro", "Descrição completa",
             "Setor, dimensão, website, especialidades"],
            ["URL personalizado: linkedin.com/in/seunome",
             "Evitar números aleatórios",
             "Usar o mesmo identificador das outras redes",
             "Atualizar cartões e assinatura de email"],
            "Página de empresa", "URL personalizado")

    def m3_strat(s):
        _title_block(s, "3.5–3.6 Estratégia e Networking", "Publicar + comentar + conectar com intenção")
        _bullets(s, [
            "Artigos vs publicações curtas — misture formatos",
            "Frequência ideal: 2–5×/semana",
            "Comentar e interagir em posts relevantes (antes de vender)",
            "Entrar em grupos profissionais do seu setor",
            "Pedir e dar recomendações genuínas",
            "Pedidos de conexão com mensagem personalizada",
            "Construir autoridade com consistência, não com spam",
        ])

    def m3_ex(s):
        _exercise_slide(s, "3", "LinkedIn em ação", [
            "Otimizar perfil pessoal LinkedIn",
            "Criar/otimizar página de empresa",
            "Escrever a primeira publicação profissional",
        ])

    builders += [
        ("m3d", m3_div, False), ("m3i", m3_imp, True), ("m3p", m3_perfil, True),
        ("m3g", m3_page, True), ("m3s", m3_strat, True), ("m3e", m3_ex, True),
    ]

    # ── MÓDULO 4 INSTAGRAM ────────────────────────────────────────────────
    def m4_div(s):
        _section_divider(s, "4", "Instagram — Visual e Engagement", "Estética, frequência e comunidade")

    def m4_biz(s):
        _title_block(s, "4.1–4.2 Conta e Perfil Otimizado", "Conta profissional = ferramentas de negócio")
        _two_col(s,
            ["Converter conta pessoal → profissional",
             "Acesso a Insights e contactos",
             "Categoria de negócio",
             "Botões de contacto / email / direção"],
            ["Foto de perfil (Canva)",
             "@ consistente com outras redes",
             "Nome pesquisável + bio (150 car.)",
             "Link na bio (Linktree ou similar)"],
            "Conta profissional", "Perfil otimizado")

    def m4_feed(s):
        _title_block(s, "4.3–4.4 Estética do Feed e Tipos de Conteúdo", "O grid é a sua montra")
        _cards(s, [
            ("Feed", "Publicações permanentes. Planeie o grid (ex.: 9 posts)."),
            ("Stories", "Conteúdo 24h. Destaques: Sobre, Serviços, FAQ, Contacto."),
            ("Reels", "Vídeos curtos — maior alcance orgânico atual."),
            ("Guias", "Curadoria de conteúdos por tema."),
        ], top=1.5, card_h=2.3)
        tip = s.shapes.add_textbox(Inches(0.5), Inches(4.2), Inches(12.3), Inches(2))
        tf = tip.text_frame
        tf.word_wrap = True
        _set_run(tf.paragraphs[0], "Consistência visual", FONT_TITLE, 14, True, BLUE)
        p = tf.add_paragraph()
        p.space_before = Pt(8)
        _set_run(p, "Use a paleta do Canva, alterne tipos de conteúdo e organize destaques com capas uniformes.",
                 FONT_BODY, 14, False, GRAY)

    def m4_pub(s):
        _title_block(s, "4.5–4.7 Publicação, Stories e Insights", "Estratégia + medição")
        _bullets(s, [
            "Frequência: mínimo 3–5×/semana no feed",
            "Legendas envolventes + 10–15 hashtags estratégicas + geolocalização",
            "Stories: templates Canva + enquetes e perguntas",
            "Destaques essenciais: Sobre · Serviços/Produtos · Testemunhos · Contacto · FAQ",
            "Insights: alcance, engagement rate, melhores horários, demografia",
        ])

    def m4_ex(s):
        _exercise_slide(s, "4", "Instagram profissional", [
            "Converter para conta profissional",
            "Criar bio otimizada",
            "Criar 5 destaques com capas do Canva",
            "Planear grid de 9 publicações",
        ])

    builders += [
        ("m4d", m4_div, False), ("m4b", m4_biz, True), ("m4f", m4_feed, True),
        ("m4p", m4_pub, True), ("m4e", m4_ex, True),
    ]

    # ── MÓDULO 5 WHATSAPP ─────────────────────────────────────────────────
    def m5_div(s):
        _section_divider(s, "5", "WhatsApp Business", "Comunicação direta, rápida e profissional")

    def m5_cfg(s):
        _title_block(s, "5.1–5.2 Business vs Normal + Perfil", "Separe o canal profissional do pessoal")
        _two_col(s,
            ["Perfil comercial dedicado", "Catálogo de produtos/serviços",
             "Mensagens automáticas", "Etiquetas e respostas rápidas",
             "Listas de transmissão"],
            ["Foto profissional (Canva)", "Nome do negócio",
             "Descrição / Sobre + categoria", "Morada, horário, website, email"],
            "Vantagens Business", "Configuração do perfil")

    def m5_tools(s):
        _title_block(s, "5.3–5.5 Ferramentas Empresariais", "Catálogo · Automáticas · Respostas · Etiquetas")
        _bullets(s, [
            "Catálogo: 5+ produtos/serviços com foto, descrição e preço",
            "Mensagens: saudação + ausência + respostas rápidas",
            "Atalhos FAQ: horários, preços, localização, agradecimento",
            "Etiquetas: Novo cliente · Pagamento pendente · Pedido concluído · Seguimento",
            "Listas de transmissão ≠ grupos — use com moderação (não spam)",
        ])

    def m5_api(s):
        _title_block(s, "5.6–5.8 Escala e Profissionalismo", "Tom, tempo e limites")
        _bullets(s, [
            "WhatsApp Business API: multi-atendente e CRM (empresas maiores)",
            "Tempo de resposta: máx. 1h em horário comercial",
            "Tom claro, cordial e alinhado com a marca",
            "Áudio com cuidado — prefira texto para registo e clareza",
            "Nunca misturar conversas pessoais com o canal profissional",
        ])

    def m5_ex(s):
        _exercise_slide(s, "5", "WhatsApp Business completo", [
            "Configurar WhatsApp Business (perfil 100%)",
            "Criar catálogo com 5 produtos/serviços",
            "Programar mensagens automáticas",
            "Criar 10 respostas rápidas",
        ])

    builders += [
        ("m5d", m5_div, False), ("m5c", m5_cfg, True), ("m5t", m5_tools, True),
        ("m5a", m5_api, True), ("m5e", m5_ex, True),
    ]

    # ── MÓDULO 6 EMAIL ────────────────────────────────────────────────────
    def m6_div(s):
        _section_divider(s, "6", "Email Corporativo", "Credibilidade: nome@suaempresa.com")

    def m6_dom(s):
        _title_block(s, "6.1–6.4 Domínio e Estrutura de Emails", "Email gratuito vs domínio próprio")
        _two_col(s,
            ["Registar domínio (.pt, .com…)", "Fornecedores: GoDaddy, Hostinger, IONOS, PT Server",
             "Google Workspace / Microsoft 365 / Zoho / hosting",
             "Exemplo: nome@suaempresa.com"],
            ["geral@empresa.com", "comercial@empresa.com",
             "suporte@empresa.com", "seunome@empresa.com"],
            "Adquirir e configurar", "Estrutura recomendada")

    def m6_sig(s):
        _title_block(s, "6.5–6.8 Assinatura Profissional", "Canva 600×200 px + instalação no cliente de email")
        _bullets(s, [
            "Elementos: Nome · Cargo · Empresa · Telefone/WhatsApp · Email · Website · Redes · Logo",
            "Criar no Canva (cores da marca) → exportar PNG",
            "Instalar: Gmail (Definições > Geral) · Outlook (Opções > Assinaturas) · Apple Mail",
            "Ferramentas: HubSpot Signature · WiseStamp · Newoldstamp · MySignature",
        ])

    def m6_bp(s):
        _title_block(s, "6.9–6.10 Boas Práticas e Continuidade", "Comunicar bem e manter contacto")
        _bullets(s, [
            "Assunto claro · saudação profissional · corpo objetivo · despedida cordial",
            "Sempre com assinatura · responder em < 24h · evitar Reply All desnecessário",
            "Backup de contactos + sincronização entre dispositivos",
            "CRM básico (Google Contacts, HubSpot)",
            "Templates: boas-vindas, agradecimento, follow-up, newsletter (se aplicável)",
        ])

    def m6_ex(s):
        _exercise_slide(s, "6", "Email profissional", [
            "Pesquisar disponibilidade de domínio",
            "Criar assinatura profissional no Canva",
            "Instalar assinatura no email",
            "Escrever template de email profissional",
        ])

    builders += [
        ("m6d", m6_div, False), ("m6o", m6_dom, True), ("m6s", m6_sig, True),
        ("m6b", m6_bp, True), ("m6e", m6_ex, True),
    ]

    # ── MÓDULO 7 INTEGRAÇÃO ───────────────────────────────────────────────
    def m7_div(s):
        _section_divider(s, "7", "Integração e Consistência", "Uma marca · vários canais · mesma experiência")

    def m7_id(s):
        _title_block(s, "7.1–7.2 Identidade e @ Consistentes", "Checklist de alinhamento")
        _bullets(s, [
            "Mesma foto de perfil em todas as plataformas",
            "Mesmas cores, logo e tom de comunicação",
            "Mesmo @ (ou variação próxima) em todas as redes",
            "Facebook: @___________",
            "Instagram: @___________",
            "LinkedIn: /in/___________",
            "Website: www.___________.com",
            "Email: ______@_________.com",
        ], size=15)

    def m7_cross(s):
        _title_block(s, "7.3–7.5 Cross-Promotion e Hub de Links", "Ligue os canais entre si")
        _cards(s, [
            ("Cross-promotion", "Mencionar Instagram no Facebook, partilhar LinkedIn, QR WhatsApp."),
            ("Dados iguais", "Horários, contactos, morada e website sincronizados."),
            ("Linktree / Bio.link", "Hub único: site, redes, WhatsApp, email, catálogo, reservas."),
            ("Auditoria", "Rever mensalmente se algo ficou desatualizado."),
        ], top=1.5, card_h=2.5)

    def m7_ex(s):
        _exercise_slide(s, "7", "Consistência total", [
            "Fazer auditoria de consistência",
            "Criar lista de todos os perfis/URLs",
            "Criar Linktree (ou similar) com todos os canais",
        ])

    builders += [
        ("m7d", m7_div, False), ("m7i", m7_id, True), ("m7c", m7_cross, True),
        ("m7e", m7_ex, True),
    ]

    # ── MÓDULO 8 GESTÃO ───────────────────────────────────────────────────
    def m8_div(s):
        _section_divider(s, "8", "Gestão e Planeamento", "Sistema > motivação: ritmos e métricas")

    def m8_plan(s):
        _title_block(s, "8.1–8.3 Calendário, Agendamento e Tempo", "Trabalhe em lote, publique com calma")
        _bullets(s, [
            "Planear mensalmente (Google Calendar, Trello, Notion, Sheets)",
            "Agendar: Meta Business Suite · LinkedIn nativo · Buffer/Hootsuite",
            "Batch creation: 1–2h/semana a criar conteúdo",
            "15 min/dia para interação e respostas",
            "Definir horários fixos na agenda — trate como compromisso",
        ])

    def m8_metrics(s):
        _title_block(s, "8.4–8.5 Análise e Banco de Ideias", "Medir para ajustar")
        _two_col(s,
            ["Alcance e impressões", "Engagement (likes, comentários, partilhas)",
             "Crescimento de seguidores", "Cliques no site / mensagens",
             "Revisão mensal + ajustes"],
            ["Educacional", "Promocional", "Inspiracional",
             "Bastidores", "Testemunhos", "Dicas / FAQs", "Datas comemorativas"],
            "Métricas-chave", "Categorias de conteúdo")

    def m8_ex(s):
        _exercise_slide(s, "8", "Planeamento operacional", [
            "Criar calendário de 30 dias",
            "Agendar 1 semana de conteúdo",
            "Definir 3 KPIs para acompanhar",
        ])

    builders += [
        ("m8d", m8_div, False), ("m8p", m8_plan, True), ("m8m", m8_metrics, True),
        ("m8e", m8_ex, True),
    ]

    # ── MÓDULO 9 PRÁTICA ──────────────────────────────────────────────────
    def m9_div(s):
        _section_divider(s, "9", "Sessão Prática", "Exemplos reais · feedback · simulações")

    def m9_cases(s):
        _title_block(s, "9.1–9.2 Casos de Sucesso e a Melhorar", "Aprender pelo contraste")
        _two_col(s,
            ["3 perfis exemplares do setor", "O que fazem bem (visuais, bio, CTA)",
             "O que podemos replicar já esta semana"],
            ["Erros comuns: foto má, bio vazia, inconsistência",
             "Como corrigir passo a passo",
             "Exercício Antes / Depois"],
            "Sucesso", "A melhorar")

    def m9_group(s):
        _title_block(s, "9.3–9.4 Prática em Grupo e Simulações", "Feedback construtivo + situações reais")
        _bullets(s, [
            "Cada participante partilha o perfil atual",
            "Feedback do grupo: 2 pontos fortes + 2 melhorias",
            "Simulações: mensagem difícil no WhatsApp",
            "Publicação de emergência / crise leve",
            "Comentário negativo — como responder com profissionalismo",
            "Email urgente — estrutura e tom",
        ])

    def m9_ex(s):
        _exercise_slide(s, "9", "Feedback e melhorias", [
            "Apresentar o seu perfil",
            "Receber e dar feedback",
            "Listar 5 melhorias para implementar",
        ])

    builders += [
        ("m9d", m9_div, False), ("m9c", m9_cases, True), ("m9g", m9_group, True),
        ("m9e", m9_ex, True),
    ]

    # ── MÓDULO 10 PLANO ───────────────────────────────────────────────────
    def m10_div(s):
        _section_divider(s, "10", "Plano de Ação Pessoal", "Da formação à execução em 30 dias")

    def m10_check1(s):
        _title_block(s, "10.1 Checklist — Canva · Facebook · LinkedIn", "Marque o que já está feito")
        _checklist(s, [
            "CANVA: conta · kit de marca · templates essenciais · pasta organizada",
            "FACEBOOK: página · informações · visuais · CTA",
            "LINKEDIN: perfil · página empresa · URL personalizado · 1ª publicação",
        ], size=16)

    def m10_check2(s):
        _title_block(s, "10.1 Checklist — Instagram · WhatsApp · Email · Geral", "Complete a auditoria")
        _checklist(s, [
            "INSTAGRAM: conta profissional · bio · destaques · grid planeado",
            "WHATSAPP: app · perfil · catálogo · mensagens automáticas",
            "EMAIL: domínio · email corporativo · assinatura · templates",
            "GERAL: @ consistentes · Linktree · calendário 30 dias · agendamento",
        ], size=16)

    def m10_30(s):
        _title_block(s, "10.2 Plano de 30 Dias", "Quatro semanas com foco claro")
        _cards(s, [
            ("Semana 1 — Fundação", "Kit Canva · FB + IG · LinkedIn + WhatsApp Business"),
            ("Semana 2 — Conteúdo", "20 templates · calendário · agendar 10 posts"),
            ("Semana 3 — Email", "Domínio · email · assinatura · Linktree"),
            ("Semana 4 — Otimizar", "Métricas · ajustes · networking · revisão"),
        ], top=1.5, card_h=2.8)

    def m10_smart(s):
        _title_block(s, "10.3 Objetivos SMART", "Específicos · Mensuráveis · Alcançáveis · Relevantes · Temporizados")
        bad = s.shapes.add_textbox(Inches(0.5), Inches(1.5), Inches(12.3), Inches(1.2))
        bf = bad.text_frame
        bf.word_wrap = True
        _set_run(bf.paragraphs[0], "❌  \"Ter mais seguidores\"", FONT_BODY, 18, False, GRAY)
        good = s.shapes.add_textbox(Inches(0.5), Inches(2.5), Inches(12.3), Inches(1.5))
        gf = good.text_frame
        gf.word_wrap = True
        _set_run(gf.paragraphs[0],
                 "✅  \"Ganhar 100 seguidores no Instagram em 30 dias através de 5 posts/semana e 10 interações diárias\"",
                 FONT_BODY, 16, True, BLUE)
        note = s.shapes.add_textbox(Inches(0.5), Inches(4.3), Inches(12.3), Inches(2))
        nf = note.text_frame
        nf.word_wrap = True
        _set_run(nf.paragraphs[0], "Escreva agora 2–3 objetivos SMART para o seu negócio:", FONT_TITLE, 14, True, ORANGE)
        p = nf.add_paragraph()
        p.space_before = Pt(12)
        _set_run(p, "1. _______________________________________________", FONT_BODY, 14, False, GRAY)
        p2 = nf.add_paragraph()
        _set_run(p2, "2. _______________________________________________", FONT_BODY, 14, False, GRAY)
        p3 = nf.add_paragraph()
        _set_run(p3, "3. _______________________________________________", FONT_BODY, 14, False, GRAY)

    def m10_commit(s):
        _title_block(s, "10.4–10.5 Recursos, Apoio e Compromisso", "Assine o seu compromisso")
        _bullets(s, [
            "Guarde links úteis, grupos de apoio e tutoriais recomendados",
            "Eu, __________________, comprometo-me a:",
            "1. Implementar _____ melhorias esta semana",
            "2. Dedicar _____ horas/semana à presença digital",
            "3. Publicar _____ vezes por semana",
            "4. Rever progresso a cada _____ dias",
            "Assinatura: ________________    Data: ___/___/______",
        ], size=15)

    builders += [
        ("m10d", m10_div, False), ("m10c1", m10_check1, True), ("m10c2", m10_check2, True),
        ("m10p", m10_30, True), ("m10s", m10_smart, True), ("m10m", m10_commit, True),
    ]

    # ── MÓDULO 11 RECURSOS ────────────────────────────────────────────────
    def m11_div(s):
        _section_divider(s, "11", "Recursos e Anexos", "Templates · Links · Glossário · FAQs")

    def m11_links(s):
        _title_block(s, "11.1–11.2 Templates e Links Úteis", "Comece com estes recursos")
        _two_col(s,
            ["Calendário editorial (Excel/Sheets)", "Banco de ideias de conteúdo",
             "Scripts de respostas rápidas", "Checklist de publicação"],
            ["canva.com", "business.facebook.com", "linkedin.com",
             "linktr.ee", "unsplash.com / pexels.com",
             "godaddy.com · hostinger.pt"],
            "Templates prontos", "Links úteis")

    def m11_gloss(s):
        _title_block(s, "11.3 Glossário", "Linguagem comum da presença digital")
        _bullets(s, [
            "CTA — Call to Action (chamada à ação)",
            "Engagement — envolvimento (likes, comentários, partilhas)",
            "Alcance — pessoas que viram o conteúdo",
            "Impressões — vezes que o conteúdo foi exibido",
            "Bio — biografia/descrição do perfil",
            "Feed — linha do tempo de publicações",
            "Stories — conteúdo temporário (24h)",
            "Hashtag — etiqueta # para categorizar",
            "DM — Direct Message (mensagem direta)",
        ], size=14)

    def m11_faq(s):
        _title_block(s, "11.4 FAQs", "Respostas rápidas às dúvidas mais comuns")
        faqs = [
            ("Preciso estar em todas as redes?", "Não. Escolha 2–3 onde o seu público está mais ativo."),
            ("Quanto tempo até ver resultados?", "Consistência é chave. Mínimo 3–6 meses com publicações regulares."),
            ("Posso usar email gratuito?", "Pode, mas domínio próprio transmite muito mais profissionalismo."),
            ("Canva gratuito basta?", "Sim. O Pro tem extras, mas o gratuito é excelente para começar."),
        ]
        box = s.shapes.add_textbox(Inches(0.5), Inches(1.4), Inches(12.3), Inches(5.4))
        tf = box.text_frame
        tf.word_wrap = True
        first = True
        for q, a in faqs:
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            p.space_before = Pt(10)
            _set_run(p, f"P: {q}", FONT_TITLE, 14, True, BLUE)
            p2 = tf.add_paragraph()
            _set_run(p2, f"R: {a}", FONT_BODY, 13, False, GRAY)

    def encerramento(s):
        _rect(s, 0, 0, SLIDE_W, SLIDE_H, BLUE)
        _rect(s, 0, Inches(6.8), SLIDE_W, Inches(0.7), ORANGE)
        t = s.shapes.add_textbox(Inches(0.8), Inches(2.4), Inches(11.5), Inches(1.2))
        tp = t.text_frame.paragraphs[0]
        tp.alignment = PP_ALIGN.CENTER
        _set_run(tp, "Obrigado!", FONT_TITLE, 44, True, WHITE)
        sub = s.shapes.add_textbox(Inches(0.8), Inches(3.8), Inches(11.5), Inches(1))
        sp = sub.text_frame.paragraphs[0]
        sp.alignment = PP_ALIGN.CENTER
        _set_run(sp, "Presença Digital Profissional para Negócios\nConsistência · Clareza · Compromisso", FONT_BODY, 18, False, LIGHT_BLUE)

    builders += [
        ("m11d", m11_div, False), ("m11l", m11_links, True), ("m11g", m11_gloss, True),
        ("m11f", m11_faq, True), ("end", encerramento, False),
    ]

    # Build all slides
    total_with_footer = sum(1 for _, _, f in builders if f)
    page = 0
    for _, fn, with_footer in builders:
        slide = _blank(prs)
        fn(slide)
        if with_footer:
            page += 1
            _footer(slide, page, total_with_footer)

    prs.save(OUT)
    print(f"Apresentação criada: {OUT}")
    print(f"Total de slides: {len(prs.slides)}")
    return OUT


if __name__ == "__main__":
    build()
