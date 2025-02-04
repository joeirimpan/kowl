package owl

import (
	"context"
	"fmt"
	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kmsg"
	"github.com/twmb/franz-go/pkg/kversion"
	"go.uber.org/zap"
	"sort"
	"time"

	"golang.org/x/sync/errgroup"
)

// ClusterInfo describes the brokers in a cluster
type ClusterInfo struct {
	ControllerID int32     `json:"controllerId"`
	Brokers      []*Broker `json:"brokers"`
	KafkaVersion string    `json:"kafkaVersion"`
}

// Broker described by some basic broker properties
type Broker struct {
	BrokerID   int32   `json:"brokerId"`
	LogDirSize int64   `json:"logDirSize"`
	Address    string  `json:"address"`
	Rack       *string `json:"rack"`
}

// GetClusterInfo returns generic information about all brokers in a Kafka cluster and returns them
func (s *Service) GetClusterInfo(ctx context.Context) (*ClusterInfo, error) {
	eg, _ := errgroup.WithContext(ctx)

	var logDirsByBroker map[int32]LogDirsByBroker
	var metadata *kmsg.MetadataResponse
	kafkaVersion := "unknown"

	// We use a child context with a shorter timeout because otherwise we'll potentially have very long response
	// times in case of a single broker being down.
	childCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()

	eg.Go(func() error {
		var err error
		logDirsByBroker, err = s.logDirsByBroker(childCtx)
		if err != nil {
			s.logger.Warn("failed to request brokers log dirs", zap.Error(err))
		}
		return nil
	})

	eg.Go(func() error {
		var err error
		metadata, err = s.kafkaSvc.GetMetadata(childCtx, nil)
		if err != nil {
			return err
		}
		return nil
	})

	eg.Go(func() error {
		var err error
		kafkaVersion, err = s.GetKafkaVersion(childCtx)
		if err != nil {
			s.logger.Warn("failed to request kafka version", zap.Error(err))
		}
		return nil
	})
	if err := eg.Wait(); err != nil {
		return nil, err
	}

	brokers := make([]*Broker, len(metadata.Brokers))
	for i, broker := range metadata.Brokers {
		size := int64(-1)
		if value, ok := logDirsByBroker[broker.NodeID]; ok {
			size = value.TotalSizeBytes
		}

		brokers[i] = &Broker{
			BrokerID:   broker.NodeID,
			LogDirSize: size,
			Address:    broker.Host,
			Rack:       broker.Rack,
		}
	}
	sort.Slice(brokers, func(i, j int) bool {
		return brokers[i].BrokerID < brokers[j].BrokerID
	})

	return &ClusterInfo{
		ControllerID: metadata.ControllerID,
		Brokers:      brokers,
		KafkaVersion: kafkaVersion,
	}, nil
}

func (s *Service) GetKafkaVersion(ctx context.Context) (string, error) {
	apiVersions, err := s.kafkaSvc.GetAPIVersions(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to request api versions: %w", err)
	}

	err = kerr.ErrorForCode(apiVersions.ErrorCode)
	if err != nil {
		return "", fmt.Errorf("failed to request api versions. Inner Kafka error: %w", err)
	}

	versions := kversion.FromApiVersionsResponse(apiVersions)

	return versions.VersionGuess(), nil
}
