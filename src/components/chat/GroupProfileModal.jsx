import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../context/authContext";
import {
  getGroupDetails,
  requestGroupJoin,
  removeGroupMember,
  addGroupMember,
  deleteGroup,
  searchUsers,
} from "../../services/api";
import BlueTick from "../common/BlueTick";
import { buildUserPreview, normalizeUserId } from "../../utils/userProfile";

const ANONYMOUS_AVATAR = "https://placehold.co/100x100/9ca3af/ffffff?text=U";

const resolveId = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    return String(
      value._id || value.id || value.userId || value.user_id || value.memberId || ""
    );
  }
  return "";
};

const resolveUserDisplay = (user) => {
  if (!user || typeof user !== "object") {
    return { id: resolveId(user), displayName: "User", profilePicUrl: ANONYMOUS_AVATAR };
  }
  const id = resolveId(user);
  const displayName =
    user.displayName || user.fullName || user.username || user.name || "User";
  const profilePicUrl =
    user.profilePicUrl ||
    user.profilePic ||
    user.avatarUrl ||
    user.avatar ||
    user.photoUrl ||
    ANONYMOUS_AVATAR;
  const isVerified = Boolean(
    user.isVerified ||
      user.isVerifiedCommunity ||
      user.verifiedCommunity ||
      user.communityVerified ||
      user.verified ||
      user.is_verified
  );
  return { id, displayName, profilePicUrl, isVerified };
};

export default function GroupProfileModal({
  isOpen,
  group,
  onClose,
  onMembershipChange,
  onDeleted,
  onOpenProfile,
}) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const currentUserId =
    currentUser?.id || currentUser?._id || currentUser?.userId || currentUser?.user_id || "";
  const [details, setDetails] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [addMemberValue, setAddMemberValue] = useState("");
  const [addMemberError, setAddMemberError] = useState("");
  const [memberSuggestions, setMemberSuggestions] = useState([]);
  const [memberSuggestLoading, setMemberSuggestLoading] = useState(false);
  const [memberSuggestOpen, setMemberSuggestOpen] = useState(false);
  const memberSuggestRef = useRef(null);
  const memberSuggestAbortRef = useRef(null);
  const memberSuggestRequestRef = useRef(0);

  const groupId = group?.id || group?._id || group?.groupId || group?.group_id || "";
  const apiId =
    group?.apiId ||
    group?.groupId ||
    group?.group_id ||
    group?._id ||
    group?.id ||
    "";
  const rawVisibility =
    details?.type ||
    details?.visibility ||
    group?.type ||
    group?.visibility ||
    (group?.isPrivate ? "private" : "public");
  const visibility = String(rawVisibility || "public").toLowerCase();
  const isPrivateGroup = visibility === "private";
  const isSystemGroup = Boolean(group?.isSystemGroup) || !apiId;
  const adminIds = useMemo(() => {
    const raw = details?.admins || group?.admins || group?.adminIds || [];
    return Array.isArray(raw) ? raw.map((item) => resolveId(item)).filter(Boolean) : [];
  }, [details?.admins, group?.admins, group?.adminIds]);
  const creatorId = useMemo(
    () =>
      resolveId(
        details?.creator ||
          details?.createdBy ||
          group?.creator ||
          group?.createdBy ||
          group?.owner
      ),
    [details?.creator, details?.createdBy, group?.creator, group?.createdBy, group?.owner]
  );
  const isAdmin = Boolean(
    currentUser?.role === "super_admin" ||
      group?.isAdmin ||
      (creatorId && currentUserId && String(creatorId) === String(currentUserId)) ||
      adminIds.some((id) => currentUserId && String(id) === String(currentUserId))
  );
  const canDeleteGroup = Boolean(
    currentUser?.role === "super_admin" ||
      (creatorId && currentUserId && String(creatorId) === String(currentUserId)) ||
      adminIds.some((id) => currentUserId && String(id) === String(currentUserId))
  );

  const memberIds = useMemo(() => {
    const raw = details?.members || group?.members || group?.memberIds || [];
    return Array.isArray(raw) ? raw.map((item) => resolveId(item)).filter(Boolean) : [];
  }, [details?.members, group?.members, group?.memberIds]);

  const joinRequestIds = useMemo(() => {
    const raw = details?.joinRequests || group?.joinRequests || group?.join_requests || [];
    return Array.isArray(raw) ? raw.map((item) => resolveId(item)).filter(Boolean) : [];
  }, [details?.joinRequests, group?.joinRequests, group?.join_requests]);

  const isMember = Boolean(
    group?.isMember ??
      (currentUserId &&
        (memberIds.some((id) => String(id) === String(currentUserId)) ||
          group?.isSystemGroup))
  );
  const isPending = Boolean(
    group?.isPending ??
      (currentUserId &&
        joinRequestIds.some((id) => String(id) === String(currentUserId)))
  );

  useEffect(() => {
    if (!isOpen) {
      setDetails(null);
      setMembers([]);
      setError("");
      setLoading(false);
      setActionLoading(false);
      setAddMemberValue("");
      setAddMemberError("");
      setMemberSuggestions([]);
      setMemberSuggestLoading(false);
      setMemberSuggestOpen(false);
      return;
    }
    if (!apiId) return;
    let active = true;
    setLoading(true);
    setError("");
    getGroupDetails(apiId)
      .then((response) => {
        if (!active) return;
        const payload = response?.group || response?.item || response?.data || response;
        if (!payload) return;
        setDetails(payload);
        const membersRaw =
          payload.members ||
          payload.memberList ||
          payload.memberships ||
          payload.group?.members ||
          payload.group?.memberList ||
          [];
        const resolvedMembers = Array.isArray(membersRaw)
          ? membersRaw.map(resolveUserDisplay)
          : [];
        if (creatorId && !resolvedMembers.some((item) => item.id === creatorId)) {
          resolvedMembers.unshift(
            resolveUserDisplay(payload.creator || payload.createdBy || creatorId)
          );
        }
        setMembers(resolvedMembers);
      })
      .catch((err) => {
        if (!active) return;
        setError(err?.message || "Unable to load group details.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, apiId, creatorId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (event) => {
      if (memberSuggestRef.current && !memberSuggestRef.current.contains(event.target)) {
        setMemberSuggestOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !isAdmin || isSystemGroup) {
      setMemberSuggestions([]);
      setMemberSuggestLoading(false);
      return;
    }
    const query = String(addMemberValue || "").trim();
    if (query.length < 2) {
      setMemberSuggestions([]);
      setMemberSuggestLoading(false);
      return;
    }

    if (memberSuggestAbortRef.current) {
      memberSuggestAbortRef.current.abort();
    }
    const controller = new AbortController();
    memberSuggestAbortRef.current = controller;
    const requestId = ++memberSuggestRequestRef.current;
    setMemberSuggestLoading(true);

    const timeoutId = setTimeout(() => {
      searchUsers(query, { signal: controller.signal })
        .then((users) => {
          if (requestId !== memberSuggestRequestRef.current) return;
          const memberIdSet = new Set(members.map((user) => String(user.id)));
          const normalized = Array.isArray(users) ? users : [];
          const filtered = normalized.filter((user) => {
            const id = user?._id || user?.id;
            if (!id) return false;
            if (memberIdSet.has(String(id))) return false;
            if (currentUserId && String(id) === String(currentUserId)) return false;
            return true;
          });
          setMemberSuggestions(filtered.slice(0, 6));
        })
        .catch((err) => {
          if (err?.name === "AbortError") return;
          if (requestId !== memberSuggestRequestRef.current) return;
          setMemberSuggestions([]);
        })
        .finally(() => {
          if (requestId === memberSuggestRequestRef.current) {
            setMemberSuggestLoading(false);
          }
        });
    }, 200);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [addMemberValue, isAdmin, isOpen, isSystemGroup, members, currentUserId]);

  const handleRequestJoin = async () => {
    if (!apiId || isSystemGroup) return;
    setActionLoading(true);
    setError("");
    try {
      await requestGroupJoin(apiId);
      onMembershipChange?.(groupId, { isPending: true });
    } catch (err) {
      setError(err?.message || "Unable to send request.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!apiId || !currentUserId || isSystemGroup) return;
    setActionLoading(true);
    setError("");
    try {
      await removeGroupMember(apiId, currentUserId);
      setMembers((prev) => prev.filter((user) => String(user.id) !== String(currentUserId)));
      onMembershipChange?.(groupId, { isMember: false, isPending: false });
      onClose?.();
    } catch (err) {
      setError(err?.message || "Unable to leave group.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!apiId || !userId) return;
    setActionLoading(true);
    setError("");
    try {
      await removeGroupMember(apiId, userId);
      setMembers((prev) => prev.filter((user) => String(user.id) !== String(userId)));
    } catch (err) {
      setError(err?.message || "Unable to remove member.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!apiId) return;
    if (!confirm("Delete this group? This cannot be undone.")) return;
    setActionLoading(true);
    setError("");
    try {
      await deleteGroup(apiId);
      onDeleted?.(groupId);
      onClose?.();
    } catch (err) {
      setError(err?.message || "Unable to delete group.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddMember = async (explicitId) => {
    if (!apiId) return;
    const value = String(explicitId ?? (addMemberValue || "")).trim();
    if (!value) {
      setAddMemberError("Enter a user id to add.");
      return;
    }
    setActionLoading(true);
    setAddMemberError("");
    try {
      await addGroupMember(apiId, value);
      setMembers((prev) =>
        prev.some((user) => String(user.id) === String(value))
          ? prev
          : prev.concat({ id: value, displayName: "User", profilePicUrl: ANONYMOUS_AVATAR })
      );
      setAddMemberValue("");
      setMemberSuggestions([]);
    } catch (err) {
      setAddMemberError(err?.message || "Unable to add member.");
    } finally {
      setActionLoading(false);
    }
  };

  const groupName =
    details?.name || group?.displayName || group?.name || group?.title || "Group";
  const groupDescription = details?.description || group?.description || "";
  const groupAvatar =
    details?.profileImage ||
    details?.profilePicUrl ||
    group?.profilePicUrl ||
    group?.avatarUrl ||
    group?.avatar ||
    ANONYMOUS_AVATAR;
  const fallbackMembersRaw = details?.members || group?.members || [];
  const fallbackMembers = Array.isArray(fallbackMembersRaw)
    ? fallbackMembersRaw.map(resolveUserDisplay)
    : [];
  const displayMembers = members.length > 0 ? members : fallbackMembers;
  const memberCount =
    details?.memberCount ||
    details?.membersCount ||
    details?.member_count ||
    displayMembers.length ||
    group?.memberCount ||
    group?.members?.length ||
    0;
  const rawLimit = details?.memberLimit ?? group?.memberLimit ?? 100;
  const memberLimit = Number(rawLimit);
  const hasMemberLimit = Number.isFinite(memberLimit) && memberLimit > 0;
  const isGroupFull = hasMemberLimit && Number(memberCount) >= memberLimit;

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
          onClick={onClose}
        >
          <Motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 22, stiffness: 220 }}
            className="relative w-full max-w-2xl max-h-[80dvh] sm:max-h-[85vh] glass-card rounded-t-3xl shadow-2xl sm:rounded-3xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <img
                  src={groupAvatar}
                  alt={groupName}
                  className="h-12 w-12 rounded-2xl object-cover"
                />
                <div>
                  <p className="text-sm font-semibold text-[#faf0e6]">{groupName}</p>
                  <p className="text-[11px] text-[#b9b4c7] capitalize">
                    {visibility || "public"} group · {memberCount} members
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-xl text-[#b9b4c7] hover:text-[#faf0e6]"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-24 sm:pb-6">
              {groupDescription && (
                <p className="mt-4 text-sm text-[#b9b4c7]">{groupDescription}</p>
              )}

              {!isSystemGroup && isPending && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[12px] text-[#b9b4c7]">
                  Join request pending approval.
                </div>
              )}

              {!isSystemGroup && !isMember && !isPending && (
                <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[12px] text-[#b9b4c7]">
                  <span>
                    {isPrivateGroup
                      ? "Private group. Request approval to join."
                      : "Public group. Request approval to join."}
                  </span>
                  <button
                    type="button"
                    onClick={handleRequestJoin}
                    disabled={actionLoading || isGroupFull}
                    className={`rounded-full px-3 py-1 text-xs ${
                      isGroupFull
                        ? "bg-white/10 text-[#b9b4c7] cursor-not-allowed"
                        : "bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30"
                    }`}
                  >
                    {isGroupFull
                      ? "Group full"
                      : actionLoading
                        ? "Sending..."
                        : "Request join"}
                  </button>
                </div>
              )}

              {!isSystemGroup && isMember && (
                <div className="mt-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[12px] text-[#b9b4c7]">
                  <span>You're a member of this group.</span>
                  <button
                    type="button"
                    onClick={handleLeaveGroup}
                    disabled={actionLoading}
                    className="rounded-full bg-white/10 px-3 py-1 text-xs text-[#faf0e6] hover:bg-white/20 disabled:opacity-60"
                  >
                    Leave group
                  </button>
                </div>
              )}

              {error && (
                <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-200">
                  {error}
                </div>
              )}

              {canDeleteGroup && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleDeleteGroup}
                    disabled={actionLoading}
                    className="rounded-full bg-rose-500/20 px-4 py-2 text-xs text-rose-100 hover:bg-rose-500/30 disabled:opacity-60"
                  >
                    Delete group
                  </button>
                </div>
              )}

              {loading ? (
                <p className="mt-6 text-center text-[#b9b4c7] text-sm">Loading group…</p>
              ) : (
                <>
                  {isAdmin && !isSystemGroup && (
                    <div className="mt-6">
                      <p className="text-xs uppercase tracking-wide text-[#b9b4c7]">
                        Add member
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <div className="flex-1 min-w-[180px] relative" ref={memberSuggestRef}>
                          <input
                            type="text"
                            value={addMemberValue}
                            onChange={(e) => {
                              setAddMemberValue(e.target.value);
                              setAddMemberError("");
                              setMemberSuggestOpen(true);
                            }}
                            onFocus={() => setMemberSuggestOpen(true)}
                            placeholder="Search by name or username"
                            className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#faf0e6] placeholder:text-[#b9b4c7]"
                          />
                          {memberSuggestOpen &&
                            (memberSuggestLoading || memberSuggestions.length > 0) && (
                              <div className="absolute left-0 right-0 mt-2 rounded-2xl border border-white/10 bg-[#1a120b]/95 backdrop-blur z-20 overflow-hidden">
                                {memberSuggestLoading ? (
                                  <div className="p-3 space-y-2">
                                    {[1, 2, 3].map((item) => (
                                      <div
                                        key={`member-skeleton-${item}`}
                                        className="h-8 rounded-xl bg-white/10 animate-pulse"
                                      ></div>
                                    ))}
                                  </div>
                                ) : memberSuggestions.length === 0 ? (
                                  <div className="p-3 text-xs text-[#b9b4c7]">
                                    No matches found.
                                  </div>
                                ) : (
                                  <div className="p-2">
                                    {memberSuggestions.map((user) => {
                                      const userId = user._id || user.id;
                                      const displayName =
                                        user.fullName ||
                                        user.displayName ||
                                        user.username ||
                                        "User";
                                      const username = user.username
                                        ? `@${user.username}`
                                        : "";
                                      const avatar =
                                        user.profilePicUrl ||
                                        user.profilePic ||
                                        user.avatarUrl ||
                                        user.avatar ||
                                        ANONYMOUS_AVATAR;
                                      return (
                                        <button
                                          key={`suggest-${userId}`}
                                          type="button"
                                          onClick={() => {
                                            setAddMemberValue(String(userId));
                                            setMemberSuggestOpen(false);
                                          }}
                                          className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-[#faf0e6] hover:bg-white/10 transition-colors"
                                        >
                                          <img
                                            src={avatar}
                                            alt={displayName}
                                            className="h-6 w-6 rounded-full object-cover"
                                            loading="lazy"
                                            decoding="async"
                                          />
                                          <div className="min-w-0 flex-1">
                                            <p className="truncate">{displayName}</p>
                                            {username && (
                                              <p className="text-[10px] text-[#b9b4c7]">
                                                {username}
                                              </p>
                                            )}
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddMember()}
                          disabled={actionLoading || isGroupFull}
                          className={`rounded-full px-4 py-2 text-xs font-semibold ${
                            isGroupFull
                              ? "bg-white/10 text-[#b9b4c7] cursor-not-allowed"
                              : "bg-white/10 text-[#faf0e6] hover:bg-white/20"
                          }`}
                        >
                          {isGroupFull ? "Group full" : actionLoading ? "Adding..." : "Add"}
                        </button>
                      </div>
                      {addMemberError && (
                        <p className="mt-2 text-[11px] text-rose-200">{addMemberError}</p>
                      )}
                      {hasMemberLimit && (
                        <p className="mt-2 text-[11px] text-[#b9b4c7]">
                          Member limit: {memberLimit}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-6">
                    <p className="text-xs uppercase tracking-wide text-[#b9b4c7]">
                      Members
                    </p>
                    {displayMembers.length === 0 ? (
                      <p className="mt-2 text-sm text-[#b9b4c7]">No members yet.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {displayMembers.map((user) => (
                          <div
                            key={`member-${user.id}`}
                            className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                const safeUserId = normalizeUserId(user?.id || user);
                                if (safeUserId) {
                                  const preview = buildUserPreview(user || {}, {
                                    _id: safeUserId,
                                    fullName: user.fullName || user.name,
                                    displayName: user.displayName || user.fullName || user.name,
                                    username: user.username,
                                    profilePicUrl: user.profilePicUrl,
                                    isVerified: user.isVerified,
                                    isVerifiedCommunity: user.isVerifiedCommunity,
                                  });
                                  if (onOpenProfile) {
                                    onOpenProfile(safeUserId, preview);
                                    onClose?.();
                                    return;
                                  }
                                  navigate(`/profile/${safeUserId}`, {
                                    state: { userPreview: preview, modal: true },
                                  });
                                }
                              }}
                              className="flex items-center gap-2 text-left"
                            >
                              <img
                                src={user.profilePicUrl || ANONYMOUS_AVATAR}
                                alt={user.displayName}
                                className="h-9 w-9 rounded-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                              <div className="text-sm text-[#faf0e6] flex items-center gap-1">
                                {user.displayName}
                                {user.isVerified && <BlueTick className="text-[10px]" />}
                              </div>
                            </button>
                            {isAdmin &&
                              currentUserId &&
                              String(user.id) !== String(currentUserId) && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMember(user.id)}
                                  disabled={actionLoading}
                                  className="rounded-full bg-white/10 px-3 py-1 text-[11px] text-[#b9b4c7] hover:text-[#faf0e6] disabled:opacity-60"
                                >
                                  Remove
                                </button>
                              )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
