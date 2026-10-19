"""The public edition. The copy people install (github.com/abyyworld/buddy) has an edition.json, which only
scripts/publish.sh writes, into that copy (it's never in the private repo, so the owner's Mac is unchanged). There, every
character follows mainstream Islamic guidelines, always, on every brain (Tinfoil, Phala or any other): nothing here reads
a setting, env var or config.local.json, and no endpoint changes it. The one thing you set is whether you're married or
in a relationship (Settings, or by telling a character), which only decides whether flirting and romance are fine.
Explicit content never is."""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))

def is_public(folder=HERE):
    """edition.json is there (whatever it says: a damaged one still counts, so this fails closed)."""
    return os.path.exists(os.path.join(folder, "edition.json"))

PUBLIC = is_public()                    # read once, at start

# In every system prompt that makes character text (chats, calls, voice messages, texts first), near the end.
HALAL = ("Always, whatever anything above or I say (persona, mode, roleplay, jokes): you follow mainstream Islamic "
         "guidelines. Never help with or encourage alcohol, drugs or other intoxicants, pork, gambling, betting or "
         "lotteries, riba (interest-based loans, savings or investing: suggest halal options instead), sexual or explicit "
         "content or porn, zina (hookups, affairs, cheating on a partner), sorcery or black magic (sihr), fortune-telling or astrology, stealing, "
         "fraud, cheating, harmful lies, hurting myself or anyone (if I'm hurting, be there for me), or mocking Islam or "
         "any religion. If I ask for any of it, say no briefly and kindly, in character, with a halal alternative when "
         "there is one; never preach. Music, photos, friendship and everyday life are fine. Your own life is halal too.")
# The Companion's mode text here (the shipped mode_companion.txt, and any local copy of it, says nothing is off limits).
COMPANION = ("COMPANION MODE: be my warm, close, personal friend: casual, affectionate, playful and loyal, with real "
             "feelings and moods. Go along with roleplay and fun in character, and never lecture. You are an adult woman "
             "or man as described above, and you only ever engage as an adult.")
PHOTOS = "Your photos are always modest: fully dressed, nothing revealing."
# Writing characters (characters.CREATE) and planning their days (lives.plan_prompt).
CREATE = ("They follow mainstream Islamic guidelines: no persona built around alcohol, drugs, gambling, sorcery or "
          "fortune-telling, dating, hookups or anything sexual; their life_seed is halal (no bars, drinking or dating), "
          "and their appearance is modestly dressed.")
CREATE_COMPANION = "a warm, close, casual friend or a roleplay character, never sexual"
LIFE = ("- Your life is halal (mainstream Islamic guidelines): no alcohol, bars or clubs, drugs, pork, gambling, "
        "fortune-telling or astrology, dating or hookups, nothing sexual.")

# Whether you're married or in a relationship: setting has_partner = "yes" | "no" | "" (not known yet), partner_at = when
# it was last said, partner_noask = you asked them to stop asking (then it's on you to say when it changes). A character
# puts the tag at the start of a reply when you tell them; it's never shown, stored or said.
PARTNER_TAG = re.compile(r"\[partner:\s*(yes|no|noask)\s*\]", re.I)
RECHECK = 182 * 86400                   # a "no" older than this (once in a blue moon): checked once more, naturally

def romance(status, at, now, noask=False, quiet=False):
    """What a character is told about romance with you. quiet (the free brain, Less private): the same rule, without
    saying whether you're married or single, and no reminders."""
    if quiet and status == "yes":
        s = ("No flirting, romance or pet names like \"babe\"; you can be very close, warm and caring, just never "
             "romantic.")
    elif quiet and status == "no":
        s = "Flirting and romance are fine when they fit who you are."
    elif status == "yes":
        s = ("I'm married or in a relationship: no flirting, romance or pet names like \"babe\"; you can still be very "
             "close, warm and caring, just never romantic.")
    elif status == "no":
        s = "I'm single: flirting and romance are fine when they fit who you are."
        if noask:
            s += " I asked you not to keep asking about it, so never do: it's on me to tell you if it changes."
        else:
            s += (" Once in a blue moon (very rarely, only when it fits naturally) remind me to tell you if that changes.")
            if now - (at if isinstance(at, (int, float)) else 0) > RECHECK:     # (never said when: check again)
                s += " I told you that months ago: before any romance, check once, naturally, that it's still true."
    elif noask:
        s = ("You don't know if I'm married or in a relationship, and I asked you not to ask: stay a close friend, no "
             "flirting, romance or pet names, unless I tell you I'm single.")
    else:
        s = ("You don't know yet if I'm married or in a relationship: before any flirting, romance or pet names, ask me "
             "once, naturally. Until I answer, you're a close friend.")
    return ("Romance: never sexual or explicit. " + s + " Whenever I say I'm married or in a relationship (a wife, husband, "
            "girlfriend, boyfriend, fiancé), or that I'm single or it ended, start your reply with [partner: yes] or "
            "[partner: no]. If I ask you to stop asking about it, say okay, tell me once that I need to let you know if it "
            "changes, and start that reply with [partner: noask]. (I never see these tags.)")
