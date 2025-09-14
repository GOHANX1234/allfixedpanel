import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  MobileDialog,
  MobileDialogContent,
  MobileDialogHeader,
  MobileDialogTitle,
  MobileDialogDescription,
} from "@/components/ui/mobile-dialog";
import { Button } from "@/components/ui/button";

interface GenerateTokenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function GenerateTokenModal({
  open,
  onOpenChange,
}: GenerateTokenModalProps) {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // Generate token mutation
  const generateTokenMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/tokens/generate", {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/tokens'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/stats'] });
      onOpenChange(false);
      
      // Copy the token to clipboard
      if (data.token?.token) {
        navigator.clipboard.writeText(data.token.token);
        toast({
          title: "Token Generated",
          description: `New token has been created and copied to clipboard: ${data.token.token}`,
        });
      } else {
        toast({
          title: "Token Generated",
          description: "New referral token has been created",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to generate token",
        variant: "destructive",
      });
    },
  });

  const handleGenerateToken = () => {
    generateTokenMutation.mutate();
  };

  // Button content that's common to both dialog types
  const buttonContent = (
    <div className="mt-4">
      <Button
        className="w-full"
        onClick={handleGenerateToken}
        disabled={generateTokenMutation.isPending}
      >
        {generateTokenMutation.isPending ? "Generating..." : "Generate Token"}
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="mobile-dialog-content">
          <div className="mobile-dialog-handle"></div>
          <DialogHeader>
            <DialogTitle>Generate Referral Token</DialogTitle>
            <DialogDescription>
              Generate a new referral token that can be used to register a reseller account.
              The token will be copied to your clipboard.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4">
            {buttonContent}
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Referral Token</DialogTitle>
          <DialogDescription>
            Generate a new referral token that can be used to register a reseller account.
            The token will be copied to your clipboard.
          </DialogDescription>
        </DialogHeader>
        {buttonContent}
      </DialogContent>
    </Dialog>
  );
}
